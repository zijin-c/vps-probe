package quality

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// Options 由 Agent 主程序按当前配置提供。
type Options struct {
	Server      string // 面板地址 host:port（与 gRPC 同一端口）
	TLS         bool
	InsecureTLS bool
	UUID        string
	Secret      string
	Version     string
	Disabled    bool
}

// schedule 由面板决定：哪些内置分项该跑了（首次、到期或管理员手动触发）。
type schedule struct {
	Run  []string `json:"run"`
	Keys Keys     `json:"keys"`
}

// Start 在后台运行检测循环。面板只能通过 schedule 让 Agent "重新跑某几项内置检测"，
// 不能下发任何目标、命令或配置；未知分项名会被忽略。
func Start(get func() Options) {
	go func() {
		// 等 Agent 与面板建立连接后再开始
		time.Sleep(30 * time.Second)
		for {
			o := get()
			if !o.Disabled && o.Server != "" {
				sc, err := fetchSchedule(o)
				if err != nil {
					log.Printf("quality: 获取检测计划失败: %v", err)
				} else if parts := knownParts(sc.Run); len(parts) > 0 {
					rep := Run(context.Background(), sc.Keys, o.Version, parts)
					if err := upload(o, rep); err != nil {
						log.Printf("quality: 上报失败: %v", err)
					} else {
						log.Printf("quality: %v 检测完成，用时 %ds", parts, rep.TookSeconds)
					}
				}
			}
			time.Sleep(time.Minute)
		}
	}()
}

func knownParts(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range in {
		for _, k := range AllParts {
			if p == k && !seen[p] {
				out = append(out, p)
				seen[p] = true
			}
		}
	}
	return out
}

func baseURL(o Options) string {
	s := strings.TrimSpace(o.Server)
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return strings.TrimRight(s, "/")
	}
	if o.TLS {
		return "https://" + s
	}
	return "http://" + s
}

func panelRequest(o Options, method, path string, body any, out any) error {
	var rd *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, baseURL(o)+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-UUID", o.UUID)
	req.Header.Set("X-Agent-Secret", o.Secret)
	res, err := newClient("tcp", 30*time.Second, o.InsecureTLS).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Error   string          `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	if !env.Success {
		return fmt.Errorf("%s", env.Error)
	}
	if out != nil && len(env.Data) > 0 {
		return json.Unmarshal(env.Data, out)
	}
	return nil
}

func fetchSchedule(o Options) (schedule, error) {
	var sc schedule
	err := panelRequest(o, http.MethodGet, "/api/v1/probe/agent/quality", nil, &sc)
	return sc, err
}

func upload(o Options, r *Report) error {
	return panelRequest(o, http.MethodPost, "/api/v1/probe/agent/quality", r, nil)
}
