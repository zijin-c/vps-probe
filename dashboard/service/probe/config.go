// Package probe 是只读分支新增的功能：Telegram 交互机器人、到期/流量/离线提醒、
// 以及一键备份与恢复。配置独立存放在 data/probe.yaml，避免与面板自身
// 的 config.yaml 保存逻辑互相覆盖。
package probe

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

type TelegramConf struct {
	BotToken        string  `yaml:"bot_token"`
	ChatIDs         []int64 `yaml:"chat_ids"`
	APIBase         string  `yaml:"api_base"`
	NotifyOffline   bool    `yaml:"notify_offline"`
	OfflineSeconds  int     `yaml:"offline_seconds"`
	TrafficPercents []int   `yaml:"traffic_percents"`
	ExpireDays      []int   `yaml:"expire_days"`
	NotifyHour      int     `yaml:"notify_hour"`
}

type BackupConf struct {
	Daily          bool `yaml:"daily"`
	Hour           int  `yaml:"hour"`
	Keep           int  `yaml:"keep"`
	SendToTelegram bool `yaml:"send_to_telegram"`
	IncludeHistory bool `yaml:"include_history"`
}

// QualityConf 控制 Agent 内置的 IP / 线路质量检测。密钥都是可选的，
// 会随检测计划下发给 Agent，用于查询需要授权的 IP 数据库。
type QualityConf struct {
	IntervalHours  int    `yaml:"interval_hours"`
	IPInfoToken    string `yaml:"ipinfo_token"`
	AbuseIPDBKey   string `yaml:"abuseipdb_key"`
	IP2LocationKey string `yaml:"ip2location_key"`
}

type Config struct {
	Telegram TelegramConf `yaml:"telegram"`
	Backup   BackupConf   `yaml:"backup"`
	Quality  QualityConf  `yaml:"quality"`
}

func defaultConfig() Config {
	return Config{
		Telegram: TelegramConf{
			APIBase:         "https://api.telegram.org",
			NotifyOffline:   true,
			OfflineSeconds:  120,
			TrafficPercents: []int{80, 90, 100},
			ExpireDays:      []int{7, 3, 1},
			NotifyHour:      10,
		},
		Backup: BackupConf{
			Daily:          true,
			Hour:           4,
			Keep:           7,
			SendToTelegram: false,
			IncludeHistory: false,
		},
		Quality: QualityConf{IntervalHours: 24},
	}
}

const configTemplate = `# 只读探针扩展配置（Telegram 机器人 + 备份）
# 修改后重启面板生效。也可用环境变量覆盖：PROBE_TG_TOKEN、PROBE_TG_CHAT_IDS（逗号分隔）
telegram:
  bot_token: ""            # 从 @BotFather 获取
  chat_ids: []             # 允许使用机器人/接收通知的 chat id，给机器人发 /id 可查看
  api_base: "https://api.telegram.org"  # 国内机器可换成自建反代地址
  notify_offline: true     # 离线/恢复通知
  offline_seconds: 120     # 超过多少秒无上报视为离线
  traffic_percents: [80, 90, 100]  # 周期流量达到这些百分比时提醒（需在面板配置周期流量告警规则）
  expire_days: [7, 3, 1]   # 到期前这些天提醒（读取服务器"公开备注"里的账单信息）
  notify_hour: 10          # 每天几点检查到期

backup:
  daily: true              # 每天自动备份到 data/backups/
  hour: 4                  # 几点执行
  keep: 7                  # 保留份数
  send_to_telegram: false  # 同时把备份文件发给 Telegram（文件里含密钥，注意私聊）
  include_history: false   # 是否包含 TSDB 监控历史（体积较大）

quality:                   # Agent 内置的 IP 质量 / 流媒体解锁 / 三网回程检测
  interval_hours: 24       # 自动重测间隔
  ipinfo_token: ""         # 可选：ipinfo.io token，额外提供使用类型与隐私标记
  abuseipdb_key: ""        # 可选：AbuseIPDB 免费密钥，提供滥用评分
  ip2location_key: ""      # 可选：IP2Location.io 密钥，提供欺诈评分
`

var (
	confMu   sync.RWMutex
	conf     = defaultConfig()
	dataDir  = "data"
	confPath = filepath.Join("data", "probe.yaml")
)

// Init 加载 probe.yaml；文件不存在时写入带注释的模板。
func Init(dir string) error {
	dataDir = dir
	confPath = filepath.Join(dir, "probe.yaml")
	c := defaultConfig()
	b, err := os.ReadFile(confPath)
	switch {
	case os.IsNotExist(err):
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(confPath, []byte(configTemplate), 0o600); err != nil {
			return err
		}
		log.Printf("PROBE>> 已生成配置模板 %s", confPath)
	case err != nil:
		return err
	default:
		if err := yaml.Unmarshal(b, &c); err != nil {
			return fmt.Errorf("解析 %s 失败: %w", confPath, err)
		}
	}
	if v := strings.TrimSpace(os.Getenv("PROBE_TG_TOKEN")); v != "" {
		c.Telegram.BotToken = v
	}
	if v := strings.TrimSpace(os.Getenv("PROBE_TG_CHAT_IDS")); v != "" {
		c.Telegram.ChatIDs = nil
		for _, p := range strings.Split(v, ",") {
			if id, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64); err == nil {
				c.Telegram.ChatIDs = append(c.Telegram.ChatIDs, id)
			}
		}
	}
	if c.Telegram.APIBase == "" {
		c.Telegram.APIBase = "https://api.telegram.org"
	}
	c.Telegram.APIBase = strings.TrimRight(c.Telegram.APIBase, "/")
	if c.Telegram.OfflineSeconds < 30 {
		c.Telegram.OfflineSeconds = 30
	}
	if c.Backup.Keep <= 0 {
		c.Backup.Keep = 7
	}
	confMu.Lock()
	conf = c
	confMu.Unlock()
	return nil
}

func getConf() Config {
	confMu.RLock()
	defer confMu.RUnlock()
	return conf
}

// DataDir 返回数据目录。
func DataDir() string { return dataDir }
