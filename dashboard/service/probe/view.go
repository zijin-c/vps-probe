package probe

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/goccy/go-json"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// publicNote 与 Nezha 官方前端"公开备注"的账单/套餐 JSON 格式一致。
type publicNote struct {
	Billing struct {
		StartDate   string `json:"startDate"`
		EndDate     string `json:"endDate"`
		AutoRenewal string `json:"autoRenewal"`
		Cycle       string `json:"cycle"`
		Amount      string `json:"amount"`
	} `json:"billingDataMod"`
	Plan struct {
		Bandwidth    string `json:"bandwidth"`
		TrafficVol   string `json:"trafficVol"`
		TrafficType  string `json:"trafficType"`
		NetworkRoute string `json:"networkRoute"`
		Extra        string `json:"extra"`
	} `json:"planDataMod"`
}

// Billing 是解析后的续费信息。
type Billing struct {
	Known       bool
	Amount      string    // 原始金额字符串，如 "$10"
	Cycle       string    // 原始周期字符串
	CycleMonths int       // 0 表示未知/一次性
	End         time.Time // 已按自动续费滚动到未来
	Permanent   bool
	AutoRenewal bool
	Route       string
}

// DaysLeft 返回剩余天数（向上取整，过期为负）。
func (b Billing) DaysLeft(now time.Time) int {
	return int(math.Ceil(b.End.Sub(now).Hours() / 24))
}

var amountRe = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)?`)

// RemainingValue 按剩余天数折算剩余价值，返回如 "$8.94"；无法计算返回 ""。
func (b Billing) RemainingValue(now time.Time) string {
	if !b.Known || b.Permanent || b.CycleMonths == 0 {
		return ""
	}
	num := amountRe.FindString(b.Amount)
	if num == "" {
		return ""
	}
	price, err := strconv.ParseFloat(num, 64)
	if err != nil || price <= 0 {
		return ""
	}
	days := b.End.Sub(now).Hours() / 24
	if days <= 0 {
		return ""
	}
	start := b.End.AddDate(0, -b.CycleMonths, 0)
	cycleDays := b.End.Sub(start).Hours() / 24
	v := price * days / cycleDays
	return strings.Replace(b.Amount, num, fmt.Sprintf("%.2f", v), 1)
}

func parseCycleMonths(s string) int {
	l := strings.ToLower(strings.TrimSpace(s))
	mult := 1
	if n := amountRe.FindString(l); n != "" {
		if v, err := strconv.Atoi(n); err == nil && v > 0 {
			mult = v
		}
	}
	switch {
	case strings.Contains(l, "month") || strings.Contains(l, "月") || l == "mo":
		return 1 * mult
	case strings.Contains(l, "quarter") || strings.Contains(l, "季"):
		return 3 * mult
	case strings.Contains(l, "half") || strings.Contains(l, "半"):
		return 6 * mult
	case strings.Contains(l, "year") || strings.Contains(l, "年") || l == "yr":
		return 12 * mult
	}
	return 0
}

var dateLayouts = []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"}

func parseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, l := range dateLayouts {
		if t, err := time.ParseInLocation(l, s, singleton.Loc); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// ParseBilling 从服务器的公开备注中解析续费信息。
func ParseBilling(s *model.Server, now time.Time) Billing {
	var b Billing
	if strings.TrimSpace(s.PublicNote) == "" {
		return b
	}
	var pn publicNote
	if err := json.Unmarshal([]byte(s.PublicNote), &pn); err != nil {
		return b
	}
	b.Amount = pn.Billing.Amount
	b.Cycle = pn.Billing.Cycle
	b.Route = pn.Plan.NetworkRoute
	b.CycleMonths = parseCycleMonths(pn.Billing.Cycle)
	b.AutoRenewal = pn.Billing.AutoRenewal == "1" || strings.EqualFold(pn.Billing.AutoRenewal, "true")
	if strings.HasPrefix(pn.Billing.EndDate, "0000") {
		b.Known, b.Permanent = true, true
		return b
	}
	end, ok := parseDate(pn.Billing.EndDate)
	if !ok {
		return b
	}
	if b.AutoRenewal && b.CycleMonths > 0 {
		for i := 0; end.Before(now) && i < 1200; i++ {
			end = end.AddDate(0, b.CycleMonths, 0)
		}
	}
	b.End, b.Known = end, true
	return b
}

// Traffic 是周期流量信息。
type Traffic struct {
	Known bool
	Used  uint64
	Limit uint64
	From  time.Time
	To    time.Time
	Rule  string
}

func (t Traffic) Percent() float64 {
	if t.Limit == 0 {
		return 0
	}
	return float64(t.Used) * 100 / float64(t.Limit)
}

// cycleTraffic 从面板"周期流量"告警规则的统计中取当前服务器的用量；
// 一台服务器命中多条规则时取配额最小的那条。返回 key 为 alertID。
func cycleTraffic() map[uint64]map[uint64]Traffic {
	out := make(map[uint64]map[uint64]Traffic)
	for alertID, st := range singleton.CopyCycleTransferStats() {
		for sid, used := range st.Transfer {
			if out[sid] == nil {
				out[sid] = make(map[uint64]Traffic)
			}
			out[sid][alertID] = Traffic{Known: true, Used: used, Limit: st.Max, From: st.From, To: st.To, Rule: st.Name}
		}
	}
	return out
}

func pickTraffic(m map[uint64]Traffic) Traffic {
	var best Traffic
	for _, t := range m {
		if !best.Known || (t.Limit > 0 && (best.Limit == 0 || t.Limit < best.Limit)) {
			best = t
		}
	}
	return best
}

// ServerView 是机器人展示用的一台服务器快照。
type ServerView struct {
	ID      uint64
	Name    string
	Online  bool
	Seen    bool
	Last    time.Time
	Host    *model.Host
	State   *model.HostState
	Billing Billing
	Traffic Traffic
}

func collectServers(now time.Time) []ServerView {
	offline := time.Duration(getConf().Telegram.OfflineSeconds) * time.Second
	traffic := cycleTraffic()
	list := singleton.ServerShared.GetSortedList()
	views := make([]ServerView, 0, len(list))
	for _, s := range list {
		snap := s.RuntimeSnapshot()
		v := ServerView{
			ID:      s.ID,
			Name:    s.Name,
			Seen:    !snap.LastActive.IsZero(),
			Last:    snap.LastActive,
			Host:    snap.Host,
			State:   snap.State,
			Billing: ParseBilling(s, now),
			Traffic: pickTraffic(traffic[s.ID]),
		}
		v.Online = v.Seen && now.Sub(snap.LastActive) < offline
		views = append(views, v)
	}
	return views
}

func fmtBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit && exp < 4; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTP"[exp])
}

func fmtDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%d 秒", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%d 分钟", int(d.Minutes()))
	}
	if d < 48*time.Hour {
		return fmt.Sprintf("%.1f 小时", d.Hours())
	}
	return fmt.Sprintf("%.1f 天", d.Hours()/24)
}

func pct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) * 100 / float64(total)
}
