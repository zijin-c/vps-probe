package probe

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/goccy/go-json"
)

// 网络出口拓扑（前台公开展示，后台编辑）与节点账号记录（仅后台可见）。
// 两份数据都是管理员手工维护的小文件，整份读写即可。

// ---------------- 拓扑 ----------------

// TopoNode 是拓扑图上的一个节点。
type TopoNode struct {
	ID       string  `json:"id"`
	Label    string  `json:"label"`
	Role     string  `json:"role"`                // client / entry / relay / exit / target
	ServerID uint64  `json:"server_id,omitempty"` // 关联的探针服务器（可选，用于显示在线状态）
	Region   string  `json:"region,omitempty"`    // 国家/地区代码，如 HK / JP
	Note     string  `json:"note,omitempty"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
}

// TopoLink 是两个节点之间的一条线路。
type TopoLink struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label,omitempty"` // 如 IPLC / CN2 GIA / WireGuard
	Kind  string `json:"kind"`            // premium / normal / tunnel / backup
	Note  string `json:"note,omitempty"`
}

// Topology 是整张拓扑图。
type Topology struct {
	Title     string     `json:"title,omitempty"`
	Desc      string     `json:"desc,omitempty"`
	Nodes     []TopoNode `json:"nodes"`
	Links     []TopoLink `json:"links"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

var (
	topoRoles = map[string]bool{"client": true, "entry": true, "relay": true, "exit": true, "target": true}
	topoKinds = map[string]bool{"premium": true, "normal": true, "tunnel": true, "backup": true}
	topoIDRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	regionRe  = regexp.MustCompile(`^[A-Za-z]{2}$`)
)

const (
	topoMaxNodes = 300
	topoMaxLinks = 800
	topoCanvasW  = 1200
	topoCanvasH  = 720
)

var (
	topoMu   sync.RWMutex
	topoData *Topology
)

func topologyPath() string { return filepath.Join(dataDir, "probe-topology.json") }

func loadTopologyLocked() {
	if topoData != nil {
		return
	}
	topoData = &Topology{Nodes: []TopoNode{}, Links: []TopoLink{}}
	b, err := os.ReadFile(topologyPath())
	if err != nil {
		return
	}
	var t Topology
	if json.Unmarshal(b, &t) == nil {
		if t.Nodes == nil {
			t.Nodes = []TopoNode{}
		}
		if t.Links == nil {
			t.Links = []TopoLink{}
		}
		topoData = &t
	}
}

// GetTopology 返回拓扑副本。
func GetTopology() Topology {
	topoMu.Lock()
	loadTopologyLocked()
	t := *topoData
	topoMu.Unlock()
	t.Nodes = append([]TopoNode{}, t.Nodes...)
	t.Links = append([]TopoLink{}, t.Links...)
	return t
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func clamp(v, lo, hi float64) float64 {
	if v != v { // NaN
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// SaveTopology 校验并保存整张拓扑。
func SaveTopology(in Topology) (Topology, error) {
	if len(in.Nodes) > topoMaxNodes {
		return Topology{}, errors.New("节点数量过多")
	}
	if len(in.Links) > topoMaxLinks {
		return Topology{}, errors.New("线路数量过多")
	}
	out := Topology{
		Title: clip(in.Title, 60),
		Desc:  clip(in.Desc, 300),
		Nodes: make([]TopoNode, 0, len(in.Nodes)),
		Links: make([]TopoLink, 0, len(in.Links)),
	}
	ids := map[string]bool{}
	for _, n := range in.Nodes {
		if !topoIDRe.MatchString(n.ID) || ids[n.ID] {
			return Topology{}, errors.New("节点 ID 无效或重复")
		}
		ids[n.ID] = true
		if !topoRoles[n.Role] {
			n.Role = "relay"
		}
		n.Label = clip(n.Label, 40)
		if n.Label == "" {
			return Topology{}, errors.New("节点名称不能为空")
		}
		n.Note = clip(n.Note, 200)
		n.Region = strings.ToUpper(strings.TrimSpace(n.Region))
		if !regionRe.MatchString(n.Region) {
			n.Region = ""
		}
		n.X = clamp(n.X, 0, topoCanvasW)
		n.Y = clamp(n.Y, 0, topoCanvasH)
		out.Nodes = append(out.Nodes, n)
	}
	lids := map[string]bool{}
	for _, l := range in.Links {
		if !topoIDRe.MatchString(l.ID) || lids[l.ID] {
			return Topology{}, errors.New("线路 ID 无效或重复")
		}
		if !ids[l.From] || !ids[l.To] || l.From == l.To {
			return Topology{}, errors.New("线路端点无效")
		}
		lids[l.ID] = true
		if !topoKinds[l.Kind] {
			l.Kind = "normal"
		}
		l.Label = clip(l.Label, 30)
		l.Note = clip(l.Note, 200)
		out.Links = append(out.Links, l)
	}
	now := time.Now()
	out.UpdatedAt = &now

	topoMu.Lock()
	defer topoMu.Unlock()
	if err := writeJSONAtomic(topologyPath(), out); err != nil {
		return Topology{}, err
	}
	topoData = &out
	return out, nil
}

// ---------------- 账号记录（仅后台） ----------------

// AccountRecord 记录一台 VPS 属于哪个商家账号。
type AccountRecord struct {
	ID        string    `json:"id"`
	ServerID  uint64    `json:"server_id,omitempty"` // 关联的探针服务器（可选）
	Name      string    `json:"name,omitempty"`      // 未关联服务器时的自定义名称
	Provider  string    `json:"provider,omitempty"`  // 商家
	Account   string    `json:"account,omitempty"`   // 登录账号 / 用户名
	Email     string    `json:"email,omitempty"`     // 注册邮箱
	PanelURL  string    `json:"panel_url,omitempty"` // 商家后台地址
	Payment   string    `json:"payment,omitempty"`   // 付款方式
	OrderID   string    `json:"order_id,omitempty"`  // 订单 / 服务编号
	Note      string    `json:"note,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
}

var (
	acctMu   sync.Mutex
	acctData []AccountRecord
	acctLoad bool
)

const acctMax = 1000

func accountsPath() string { return filepath.Join(dataDir, "probe-accounts.json") }

func loadAccountsLocked() {
	if acctLoad {
		return
	}
	acctLoad = true
	acctData = []AccountRecord{}
	b, err := os.ReadFile(accountsPath())
	if err != nil {
		return
	}
	var list []AccountRecord
	if json.Unmarshal(b, &list) == nil && list != nil {
		acctData = list
	}
}

// ListAccounts 返回全部账号记录。
func ListAccounts() []AccountRecord {
	acctMu.Lock()
	defer acctMu.Unlock()
	loadAccountsLocked()
	return append([]AccountRecord{}, acctData...)
}

// SaveAccounts 校验并整体保存账号记录。
func SaveAccounts(in []AccountRecord) ([]AccountRecord, error) {
	if len(in) > acctMax {
		return nil, errors.New("记录数量过多")
	}
	acctMu.Lock()
	defer acctMu.Unlock()
	loadAccountsLocked()
	prev := map[string]AccountRecord{}
	for _, r := range acctData {
		prev[r.ID] = r
	}
	out := make([]AccountRecord, 0, len(in))
	ids := map[string]bool{}
	now := time.Now()
	for _, r := range in {
		if !topoIDRe.MatchString(r.ID) || ids[r.ID] {
			return nil, errors.New("记录 ID 无效或重复")
		}
		ids[r.ID] = true
		r.Name = clip(r.Name, 60)
		r.Provider = clip(r.Provider, 60)
		r.Account = clip(r.Account, 120)
		r.Email = clip(r.Email, 120)
		r.PanelURL = clip(r.PanelURL, 300)
		r.Payment = clip(r.Payment, 60)
		r.OrderID = clip(r.OrderID, 80)
		r.Note = clip(r.Note, 1000)
		if r.ServerID == 0 && r.Name == "" {
			return nil, errors.New("请选择服务器或填写名称")
		}
		// 内容没变就保留原来的更新时间
		p, ok := prev[r.ID]
		p.UpdatedAt, r.UpdatedAt = time.Time{}, time.Time{}
		if ok && p == r {
			r.UpdatedAt = prev[r.ID].UpdatedAt
		} else {
			r.UpdatedAt = now
		}
		out = append(out, r)
	}
	if err := writeJSONAtomic(accountsPath(), out); err != nil {
		return nil, err
	}
	acctData = out
	return append([]AccountRecord{}, out...), nil
}

func writeJSONAtomic(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
