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

type SiteConf struct {
	FooterText string `yaml:"footer_text"`
}

type Config struct {
	Site     SiteConf     `yaml:"site"`
	Telegram TelegramConf `yaml:"telegram"`
	Backup   BackupConf   `yaml:"backup"`
	Quality  QualityConf  `yaml:"quality"`
}

const defaultFooterText = "只读探针，Agent 不执行任何远程指令"

func defaultConfig() Config {
	return Config{
		Site: SiteConf{
			FooterText: defaultFooterText,
		},
		Telegram: TelegramConf{
			APIBase:         "https://api.telegram.org",
			NotifyOffline:   true,
			OfflineSeconds:  120,
			TrafficPercents: []int{80, 90, 100},
			ExpireDays:      []int{7, 3, 1},
			NotifyHour:      10,
		},
		Backup: BackupConf{
			Daily:          false,
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
  daily: false             # 每天自动备份到 data/backups/（默认关闭，推荐在后台手动点击下载）
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

// ConfigView 是返回给管理后台的配置视图，敏感密钥不回显明文。
type ConfigView struct {
	Site struct {
		FooterText string `json:"footer_text"`
	} `json:"site"`
	Telegram struct {
		HasBotToken     bool    `json:"has_bot_token"`
		ChatIDs         []int64 `json:"chat_ids"`
		APIBase         string  `json:"api_base"`
		NotifyOffline   bool    `json:"notify_offline"`
		OfflineSeconds  int     `json:"offline_seconds"`
		TrafficPercents []int   `json:"traffic_percents"`
		ExpireDays      []int   `json:"expire_days"`
		NotifyHour      int     `json:"notify_hour"`
		Running         bool    `json:"running"`
	} `json:"telegram"`
	Backup struct {
		Daily          bool `json:"daily"`
		Hour           int  `json:"hour"`
		Keep           int  `json:"keep"`
		SendToTelegram bool `json:"send_to_telegram"`
		IncludeHistory bool `json:"include_history"`
	} `json:"backup"`
	Quality struct {
		IntervalHours     int  `json:"interval_hours"`
		HasIPInfoToken    bool `json:"has_ipinfo_token"`
		HasAbuseIPDBKey   bool `json:"has_abuseipdb_key"`
		HasIP2LocationKey bool `json:"has_ip2location_key"`
	} `json:"quality"`
}

// ConfigPatch 是后台提交的配置更新。密钥字段留空表示保持原值，传 "-" 表示清空。
type ConfigPatch struct {
	Site *struct {
		FooterText *string `json:"footer_text"`
	} `json:"site"`
	Telegram *struct {
		BotToken        *string  `json:"bot_token"`
		ChatIDs         *[]int64 `json:"chat_ids"`
		APIBase         *string  `json:"api_base"`
		NotifyOffline   *bool    `json:"notify_offline"`
		OfflineSeconds  *int     `json:"offline_seconds"`
		TrafficPercents *[]int   `json:"traffic_percents"`
		ExpireDays      *[]int   `json:"expire_days"`
		NotifyHour      *int     `json:"notify_hour"`
	} `json:"telegram"`
	Backup *struct {
		Daily          *bool `json:"daily"`
		Hour           *int  `json:"hour"`
		Keep           *int  `json:"keep"`
		SendToTelegram *bool `json:"send_to_telegram"`
		IncludeHistory *bool `json:"include_history"`
	} `json:"backup"`
	Quality *struct {
		IntervalHours  *int    `json:"interval_hours"`
		IPInfoToken    *string `json:"ipinfo_token"`
		AbuseIPDBKey   *string `json:"abuseipdb_key"`
		IP2LocationKey *string `json:"ip2location_key"`
	} `json:"quality"`
}

func GetConfigView() ConfigView {
	c := getConf()
	var v ConfigView
	v.Site.FooterText = c.Site.FooterText
	v.Telegram.HasBotToken = c.Telegram.BotToken != ""
	v.Telegram.ChatIDs = append([]int64{}, c.Telegram.ChatIDs...)
	if v.Telegram.ChatIDs == nil {
		v.Telegram.ChatIDs = []int64{}
	}
	v.Telegram.APIBase = c.Telegram.APIBase
	v.Telegram.NotifyOffline = c.Telegram.NotifyOffline
	v.Telegram.OfflineSeconds = c.Telegram.OfflineSeconds
	v.Telegram.TrafficPercents = append([]int{}, c.Telegram.TrafficPercents...)
	if v.Telegram.TrafficPercents == nil {
		v.Telegram.TrafficPercents = []int{}
	}
	v.Telegram.ExpireDays = append([]int{}, c.Telegram.ExpireDays...)
	if v.Telegram.ExpireDays == nil {
		v.Telegram.ExpireDays = []int{}
	}
	v.Telegram.NotifyHour = c.Telegram.NotifyHour
	v.Telegram.Running = isBotRunning()

	v.Backup.Daily = c.Backup.Daily
	v.Backup.Hour = c.Backup.Hour
	v.Backup.Keep = c.Backup.Keep
	v.Backup.SendToTelegram = c.Backup.SendToTelegram
	v.Backup.IncludeHistory = c.Backup.IncludeHistory

	v.Quality.IntervalHours = c.Quality.IntervalHours
	v.Quality.HasIPInfoToken = c.Quality.IPInfoToken != ""
	v.Quality.HasAbuseIPDBKey = c.Quality.AbuseIPDBKey != ""
	v.Quality.HasIP2LocationKey = c.Quality.IP2LocationKey != ""
	return v
}

func applySecretPatch(dst *string, src *string) bool {
	if src == nil {
		return false
	}
	v := strings.TrimSpace(*src)
	if v == "" {
		return false
	}
	if v == "-" {
		changed := *dst != ""
		*dst = ""
		return changed
	}
	changed := *dst != v
	*dst = v
	return changed
}

// SaveConfigPatch 更新内存与 data/probe.yaml，返回是否需要重启才能生效（例如修改了 TG token / chat_ids / api_base）。
func SaveConfigPatch(p ConfigPatch) (needRestart bool, err error) {
	confMu.Lock()
	c := conf
	if p.Site != nil && p.Site.FooterText != nil {
		c.Site.FooterText = strings.TrimSpace(*p.Site.FooterText)
	}
	if p.Telegram != nil {
		t := p.Telegram
		if applySecretPatch(&c.Telegram.BotToken, t.BotToken) {
			needRestart = true
		}
		if t.ChatIDs != nil {
			c.Telegram.ChatIDs = append([]int64{}, (*t.ChatIDs)...)
			needRestart = true
		}
		if t.APIBase != nil {
			base := strings.TrimRight(strings.TrimSpace(*t.APIBase), "/")
			if base == "" {
				base = "https://api.telegram.org"
			}
			if base != c.Telegram.APIBase {
				c.Telegram.APIBase = base
				needRestart = true
			}
		}
		if t.NotifyOffline != nil {
			c.Telegram.NotifyOffline = *t.NotifyOffline
		}
		if t.OfflineSeconds != nil {
			s := *t.OfflineSeconds
			if s < 30 {
				s = 30
			}
			c.Telegram.OfflineSeconds = s
		}
		if t.TrafficPercents != nil {
			c.Telegram.TrafficPercents = append([]int{}, (*t.TrafficPercents)...)
		}
		if t.ExpireDays != nil {
			c.Telegram.ExpireDays = append([]int{}, (*t.ExpireDays)...)
		}
		if t.NotifyHour != nil {
			h := *t.NotifyHour
			if h < 0 {
				h = 0
			} else if h > 23 {
				h = 23
			}
			c.Telegram.NotifyHour = h
		}
	}
	if p.Backup != nil {
		b := p.Backup
		if b.Daily != nil {
			c.Backup.Daily = *b.Daily
		}
		if b.Hour != nil {
			h := *b.Hour
			if h < 0 {
				h = 0
			} else if h > 23 {
				h = 23
			}
			c.Backup.Hour = h
		}
		if b.Keep != nil {
			k := *b.Keep
			if k < 1 {
				k = 1
			} else if k > 90 {
				k = 90
			}
			c.Backup.Keep = k
		}
		if b.SendToTelegram != nil {
			c.Backup.SendToTelegram = *b.SendToTelegram
		}
		if b.IncludeHistory != nil {
			c.Backup.IncludeHistory = *b.IncludeHistory
		}
	}
	if p.Quality != nil {
		q := p.Quality
		if q.IntervalHours != nil {
			ih := *q.IntervalHours
			if ih < 1 {
				ih = 1
			} else if ih > 720 {
				ih = 720
			}
			c.Quality.IntervalHours = ih
		}
		applySecretPatch(&c.Quality.IPInfoToken, q.IPInfoToken)
		applySecretPatch(&c.Quality.AbuseIPDBKey, q.AbuseIPDBKey)
		applySecretPatch(&c.Quality.IP2LocationKey, q.IP2LocationKey)
	}

	raw, err := yaml.Marshal(&c)
	if err != nil {
		confMu.Unlock()
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(confPath), 0o750); err != nil {
		confMu.Unlock()
		return false, err
	}
	tmp := confPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		confMu.Unlock()
		return false, err
	}
	if err := os.Rename(tmp, confPath); err != nil {
		_ = os.Remove(tmp)
		confMu.Unlock()
		return false, err
	}
	conf = c
	confMu.Unlock()
	return needRestart, nil
}

// DataDir 返回数据目录。
func DataDir() string { return dataDir }
