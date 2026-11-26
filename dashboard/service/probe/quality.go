package probe

import (
	"crypto/subtle"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/service/singleton"
)

// Agent 上报的 IP / 流媒体解锁 / 三网回程检测结果。
// 三个分项（ip / unlock / route）分别存储、分别计时，Agent 每次只上报跑过的分项，
// 这里负责合并。面板只决定"哪些内置分项该跑了"，从不下发检测目标。

const (
	partIP     = "ip"
	partUnlock = "unlock"
	partRoute  = "route"
)

var allParts = []string{partIP, partUnlock, partRoute}

// 每个分项对应报告里的哪些字段
var partFields = map[string][]string{
	partIP:     {"ipv4", "ipv6"},
	partUnlock: {"unlock"},
	partRoute:  {"routes_v4", "inbound_v4", "route_error"},
}

type qualityEntry struct {
	Sections     map[string]json.RawMessage `json:"sections"`
	PartsAt      map[string]time.Time       `json:"parts_at"`
	AgentVersion string                     `json:"agent_version,omitempty"`

	// 旧格式兼容（整份报告）
	UpdatedAt time.Time       `json:"updated_at,omitempty"`
	Report    json.RawMessage `json:"report,omitempty"`
}

type running struct {
	Parts   []string
	Started time.Time
}

var (
	qualityMu      sync.Mutex
	qualityData    map[uint64]*qualityEntry
	qualityPending = map[uint64]map[string]time.Time{} // 管理员请求、尚未被 Agent 领取
	qualityRunning = map[uint64]running{}              // Agent 已领取、尚未上报
)

const (
	runTimeout     = 6 * time.Minute
	pendingTimeout = 15 * time.Minute // Agent 离线或版本过旧时，请求不会一直挂着
)

func expirePendingLocked(serverID uint64) {
	for p, t := range qualityPending[serverID] {
		if time.Since(t) > pendingTimeout {
			delete(qualityPending[serverID], p)
		}
	}
	if len(qualityPending[serverID]) == 0 {
		delete(qualityPending, serverID)
	}
}

func qualityPath() string { return filepath.Join(dataDir, "probe-quality.json") }

func loadQualityLocked() {
	if qualityData != nil {
		return
	}
	qualityData = map[uint64]*qualityEntry{}
	b, err := os.ReadFile(qualityPath())
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &qualityData)
	for _, e := range qualityData {
		migrateEntry(e)
	}
}

// 旧版本存的是整份报告，拆成分项
func migrateEntry(e *qualityEntry) {
	if e.Sections == nil {
		e.Sections = map[string]json.RawMessage{}
	}
	if e.PartsAt == nil {
		e.PartsAt = map[string]time.Time{}
	}
	if len(e.Report) == 0 {
		return
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(e.Report, &m) == nil {
		for _, p := range allParts {
			for _, f := range partFields[p] {
				if v, ok := m[f]; ok {
					e.Sections[f] = v
				}
			}
			e.PartsAt[p] = e.UpdatedAt
		}
		if v, ok := m["error"]; ok {
			e.Sections["route_error"] = v
		}
	}
	e.Report = nil
}

func saveQualityLocked() error {
	b, err := json.Marshal(qualityData)
	if err != nil {
		return err
	}
	tmp := qualityPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, qualityPath())
}

// AuthAgent 校验 Agent 的密钥与 UUID，返回服务器 ID。
func AuthAgent(uuid, secret string) (uint64, error) {
	uuid, secret = strings.TrimSpace(uuid), strings.TrimSpace(secret)
	if uuid == "" || secret == "" {
		return 0, errors.New("unauthorized")
	}
	singleton.UserLock.RLock()
	ok := false
	for s := range singleton.AgentSecretToUserId {
		if subtle.ConstantTimeCompare([]byte(s), []byte(secret)) == 1 {
			ok = true
			break
		}
	}
	singleton.UserLock.RUnlock()
	if !ok {
		return 0, errors.New("unauthorized")
	}
	id, found := singleton.ServerShared.UUIDToID(uuid)
	if !found {
		return 0, errors.New("unknown agent")
	}
	return id, nil
}

func validParts(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range in {
		for _, k := range allParts {
			if p == k && !seen[p] {
				out = append(out, p)
				seen[p] = true
			}
		}
	}
	return out
}

// QualitySchedule 在 Agent 每分钟询问时调用：返回该跑的分项（首次、到期、管理员手动触发）。
func QualitySchedule(serverID uint64) map[string]any {
	q := getConf().Quality
	interval := time.Duration(q.IntervalHours) * time.Hour
	if interval <= 0 {
		interval = 24 * time.Hour
	}

	qualityMu.Lock()
	defer qualityMu.Unlock()
	loadQualityLocked()
	expirePendingLocked(serverID)

	var run []string
	if r, ok := qualityRunning[serverID]; !ok || time.Since(r.Started) > runTimeout {
		delete(qualityRunning, serverID)
		e := qualityData[serverID]
		for _, p := range allParts {
			_, requested := qualityPending[serverID][p]
			var last time.Time
			if e != nil {
				last = e.PartsAt[p]
			}
			if requested || last.IsZero() || time.Since(last) >= interval {
				run = append(run, p)
			}
		}
		if len(run) > 0 {
			qualityRunning[serverID] = running{Parts: run, Started: time.Now()}
			delete(qualityPending, serverID)
		}
	}
	if run == nil {
		run = []string{}
	}
	return map[string]any{
		"run": run,
		"keys": map[string]string{
			"ipinfo":      q.IPInfoToken,
			"abuseipdb":   q.AbuseIPDBKey,
			"ip2location": q.IP2LocationKey,
		},
	}
}

// SaveQuality 合并一份（可能只含部分分项的）上报。
func SaveQuality(serverID uint64, body []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		return err
	}
	var parts []string
	if raw, ok := m["parts"]; ok {
		_ = json.Unmarshal(raw, &parts)
	}
	parts = validParts(parts)
	if len(parts) == 0 {
		parts = allParts // 1.1.0 之前的 Agent 不带 parts，视为全部
	}
	if v, ok := m["error"]; ok {
		m["route_error"] = v
	}

	qualityMu.Lock()
	defer qualityMu.Unlock()
	loadQualityLocked()
	e := qualityData[serverID]
	if e == nil {
		e = &qualityEntry{Sections: map[string]json.RawMessage{}, PartsAt: map[string]time.Time{}}
		qualityData[serverID] = e
	}
	now := time.Now()
	for _, p := range parts {
		for _, f := range partFields[p] {
			if v, ok := m[f]; ok && string(v) != "null" {
				e.Sections[f] = v
			} else {
				delete(e.Sections, f)
			}
		}
		e.PartsAt[p] = now
	}
	if v, ok := m["agent_version"]; ok {
		_ = json.Unmarshal(v, &e.AgentVersion)
	}
	delete(qualityRunning, serverID)
	return saveQualityLocked()
}

// RequestQualityRefresh 让该服务器的 Agent 在下一次询问时（1 分钟内）重跑指定分项。
func RequestQualityRefresh(serverID uint64, parts []string) []string {
	parts = validParts(parts)
	if len(parts) == 0 {
		parts = allParts
	}
	qualityMu.Lock()
	defer qualityMu.Unlock()
	if qualityPending[serverID] == nil {
		qualityPending[serverID] = map[string]time.Time{}
	}
	for _, p := range parts {
		qualityPending[serverID][p] = time.Now()
	}
	return parts
}

func statusLocked(serverID uint64) map[string]any {
	expirePendingLocked(serverID)
	st := map[string]any{}
	if r, ok := qualityRunning[serverID]; ok && time.Since(r.Started) <= runTimeout {
		st["running"] = r.Parts
		st["since"] = r.Started.Format(time.RFC3339)
	}
	if p := qualityPending[serverID]; len(p) > 0 {
		var parts []string
		for k := range p {
			parts = append(parts, k)
		}
		sort.Strings(parts)
		st["pending"] = parts
	}
	return st
}

// GetQuality 返回合并后的检测结果和当前状态；guest 为 true 时遮罩本机 IP。
func GetQuality(serverID uint64, guest bool) map[string]any {
	qualityMu.Lock()
	defer qualityMu.Unlock()
	loadQualityLocked()
	out := map[string]any{"status": statusLocked(serverID)}
	e := qualityData[serverID]
	if e == nil {
		return out
	}
	var latest time.Time
	partsAt := map[string]string{}
	for p, t := range e.PartsAt {
		partsAt[p] = t.Format(time.RFC3339)
		if t.After(latest) {
			latest = t
		}
	}
	for k, v := range e.Sections {
		var x any
		if json.Unmarshal(v, &x) == nil {
			out[k] = x
		}
	}
	if v, ok := out["route_error"]; ok {
		out["error"] = v
		delete(out, "route_error")
	}
	out["parts_at"] = partsAt
	out["agent_version"] = e.AgentVersion
	if !latest.IsZero() {
		out["updated_at"] = latest.Format(time.RFC3339)
	}
	if guest {
		for _, k := range []string{"ipv4", "ipv6"} {
			if m, ok := out[k].(map[string]any); ok {
				if ip, ok := m["ip"].(string); ok {
					m["ip"] = maskIP(ip)
				}
			}
		}
	}
	return out
}

// ---- 首页卡片用的摘要 ----

type routeBrief struct {
	Label   string `json:"label"`
	Premium bool   `json:"premium,omitempty"`
	Guess   bool   `json:"guess,omitempty"`  // 去程：没有探针结果，按默认骨干网推测
	Method  string `json:"method,omitempty"` // 去程：probe / bgp / guess
}

type unlockBrief struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Region string `json:"region,omitempty"`
	Native *bool  `json:"native,omitempty"`
}

type QualityBrief struct {
	Routes  map[string]routeBrief `json:"routes,omitempty"`  // 回程：电信 / 联通 / 移动
	Inbound map[string]routeBrief `json:"inbound,omitempty"` // 去程
	Unlock  []unlockBrief         `json:"unlock,omitempty"`
	IPType string                 `json:"ip_type,omitempty"`
	Usage  string                 `json:"usage,omitempty"`
}

// QualitySummaries 为给定服务器生成摘要：每家运营商取各城市中出现最多的回程线路。
func QualitySummaries(ids []uint64) map[uint64]QualityBrief {
	qualityMu.Lock()
	defer qualityMu.Unlock()
	loadQualityLocked()
	out := map[uint64]QualityBrief{}
	for _, id := range ids {
		e := qualityData[id]
		if e == nil {
			continue
		}
		var b QualityBrief
		var routes []struct {
			Carrier string `json:"carrier"`
			Label   string `json:"label"`
			Premium bool   `json:"premium"`
		}
		if json.Unmarshal(e.Sections["routes_v4"], &routes) == nil && len(routes) > 0 {
			type tally struct {
				n       int
				premium bool
			}
			counts := map[string]map[string]*tally{}
			for _, r := range routes {
				if r.Label == "" || r.Label == "超时" || r.Label == "未识别" || r.Label == "未知" {
					continue
				}
				if counts[r.Carrier] == nil {
					counts[r.Carrier] = map[string]*tally{}
				}
				t := counts[r.Carrier][r.Label]
				if t == nil {
					t = &tally{}
					counts[r.Carrier][r.Label] = t
				}
				t.n++
				t.premium = t.premium || r.Premium
			}
			b.Routes = map[string]routeBrief{}
			for carrier, labels := range counts {
				var best string
				var bt *tally
				for l, t := range labels {
					if bt == nil || t.n > bt.n || (t.n == bt.n && t.premium && !bt.premium) || (t.n == bt.n && t.premium == bt.premium && l < best) {
						best, bt = l, t
					}
				}
				b.Routes[carrier] = routeBrief{Label: best, Premium: bt.premium}
			}
		}
		var inbound []struct {
			Carrier string `json:"carrier"`
			routeBrief
		}
		if json.Unmarshal(e.Sections["inbound_v4"], &inbound) == nil && len(inbound) > 0 {
			b.Inbound = map[string]routeBrief{}
			for _, in := range inbound {
				if in.Carrier != "" && in.Label != "" {
					b.Inbound[in.Carrier] = in.routeBrief
				}
			}
		}
		var unlock []unlockBrief
		if json.Unmarshal(e.Sections["unlock"], &unlock) == nil {
			b.Unlock = unlock
		}
		var ip struct {
			IPType  string `json:"ip_type"`
			Sources []struct {
				Usage string `json:"usage"`
			} `json:"sources"`
		}
		if json.Unmarshal(e.Sections["ipv4"], &ip) == nil || json.Unmarshal(e.Sections["ipv6"], &ip) == nil {
			b.IPType = ip.IPType
			if len(ip.Sources) > 0 {
				b.Usage = ip.Sources[0].Usage
			}
		}
		out[id] = b
	}
	return out
}

func maskIP(ip string) string {
	if strings.Contains(ip, ":") {
		parts := strings.Split(ip, ":")
		if len(parts) > 2 {
			return parts[0] + ":" + parts[1] + ":*"
		}
		return ip
	}
	p := strings.Split(ip, ".")
	if len(p) == 4 {
		return p[0] + "." + p[1] + ".*.*"
	}
	return ip
}
