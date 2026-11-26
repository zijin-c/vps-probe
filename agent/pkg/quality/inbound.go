package quality

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 去程（国内 → VPS）必须从国内发起探测，VPS 自己测不了。按以下顺序尽力获得：
//  1. Globalping（公开免费的探测网络）里位于国内三网的探针对本机 IP 做 MTR，
//     用与回程相同的骨干网前缀规则判定线路 —— 这是真实测量；
//  2. 找不到探针时，用 RIPEstat 公开 BGP 数据看本机 ASN 是否直连国内精品/骨干网；
//  3. 都没有结论时按运营商默认骨干网推测（Guess=true，页面上会标注"推测"）。

type Inbound struct {
	Carrier string   `json:"carrier"`
	Label   string   `json:"label"`
	Premium bool     `json:"premium,omitempty"`
	Guess   bool     `json:"guess,omitempty"`
	Method  string   `json:"method,omitempty"` // probe / bgp / guess
	City    string   `json:"city,omitempty"`   // 探针所在城市
	RTT     float64  `json:"rtt,omitempty"`
	Via     []string `json:"via,omitempty"`
	Hops    []Hop    `json:"hops,omitempty"`
}

var inboundCarriers = []struct {
	name  string
	magic []string
}{
	{"电信", []string{"AS4134", "China Telecom"}},
	{"联通", []string{"AS4837", "China Unicom"}},
	{"移动", []string{"AS9808", "China Mobile"}},
}

var defaultInbound = map[string]string{"电信": "163", "联通": "4837", "移动": "CMI"}

func checkInbound(ctx context.Context) []Inbound {
	ip := selfIP(ctx, "tcp4")
	if ip == "" {
		return nil
	}
	out := make([]Inbound, len(inboundCarriers))
	var wg sync.WaitGroup
	for i, c := range inboundCarriers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for _, m := range c.magic {
				if in, ok := probeInbound(ctx, ip, c.name, m); ok {
					out[i] = in
					return
				}
			}
		}(i)
	}
	wg.Wait()

	// 探针没有结论的运营商，用 BGP 直连关系补充
	var bgp map[string]Inbound
	for i, c := range inboundCarriers {
		if out[i].Label != "" {
			continue
		}
		if bgp == nil {
			bgp = bgpInbound(ctx, ip)
		}
		if in, ok := bgp[c.name]; ok {
			out[i] = in
		} else {
			out[i] = Inbound{Carrier: c.name, Label: defaultInbound[c.name], Guess: true, Method: "guess"}
		}
	}
	return out
}

// ---------- Globalping ----------

type gpResult struct {
	Status  string `json:"status"`
	Results []struct {
		Probe struct {
			City string `json:"city"`
			ASN  int    `json:"asn"`
		} `json:"probe"`
		Result struct {
			Status string `json:"status"`
			Hops   []struct {
				ResolvedAddress *string `json:"resolvedAddress"`
				ASN             []int   `json:"asn"`
				Stats           struct {
					Avg  float64 `json:"avg"`
					Loss float64 `json:"loss"`
				} `json:"stats"`
			} `json:"hops"`
		} `json:"result"`
	} `json:"results"`
}

func gpRequest(ctx context.Context, method, path string, body any, out any) error {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://api.globalping.io/v1"+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "vps-probe-readonly-agent")
	res, err := newClient("tcp", 20*time.Second, false).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("globalping HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func probeInbound(ctx context.Context, ip, carrier, magic string) (Inbound, bool) {
	var created struct {
		ID string `json:"id"`
	}
	err := gpRequest(ctx, http.MethodPost, "/measurements", map[string]any{
		"type":               "mtr",
		"target":             ip,
		"locations":          []map[string]any{{"magic": magic, "limit": 2}},
		"measurementOptions": map[string]any{"protocol": "ICMP", "packets": 3},
	}, &created)
	if err != nil || created.ID == "" {
		return Inbound{}, false
	}
	var res gpResult
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return Inbound{}, false
		case <-time.After(3 * time.Second):
		}
		if err := gpRequest(ctx, http.MethodGet, "/measurements/"+url.PathEscape(created.ID), nil, &res); err != nil {
			continue
		}
		if res.Status != "in-progress" {
			break
		}
	}

	// 多个探针里选能识别出骨干网、且最"确定"的那一条
	var best Inbound
	bestRank := -1
	for _, r := range res.Results {
		var hops []Hop
		for i, h := range r.Result.Hops {
			hp := Hop{TTL: i + 1}
			if h.ResolvedAddress != nil {
				hp.IP = *h.ResolvedAddress
				hp.RTT = h.Stats.Avg
				hp.ASN, hp.Tag = lookupASN(hp.IP)
				if hp.ASN == "" && len(h.ASN) > 0 {
					hp.ASN = fmt.Sprintf("AS%d", h.ASN[0])
				}
			}
			hops = append(hops, hp)
		}
		c := classify(carrier, hops)
		if c.label == "" || c.rank <= bestRank {
			continue
		}
		bestRank = c.rank
		best = Inbound{Carrier: carrier, Label: c.label, Premium: c.premium, Method: "probe", City: r.Probe.City, Hops: hops}
		for i := len(hops) - 1; i >= 0; i-- {
			if hops[i].RTT > 0 {
				best.RTT = hops[i].RTT
				break
			}
		}
	}
	return best, bestRank >= 0
}

// ---------- BGP 推断 ----------

var cnNeighbors = map[int]struct {
	carrier, label string
	premium        bool
	rank           int
}{
	4809: {"电信", "CN2 GIA", true, 3}, 23764: {"电信", "CTGNet", true, 2}, 4134: {"电信", "163", false, 1},
	9929: {"联通", "9929", true, 3}, 10099: {"联通", "CUG", true, 2}, 4837: {"联通", "4837", false, 1},
	58807: {"移动", "CMIN2", true, 3}, 58453: {"移动", "CMI", false, 2}, 9808: {"移动", "CMNET", false, 1},
}

func ripeJSON(ctx context.Context, path string, out any) error {
	r, err := get(ctx, newClient("tcp", 15*time.Second, false), "https://stat.ripe.net/data/"+path, map[string]string{"Accept": "application/json"})
	if err != nil {
		return err
	}
	if r.Status != 200 {
		return fmt.Errorf("RIPEstat HTTP %d", r.Status)
	}
	return json.Unmarshal([]byte(r.Body), out)
}

func bgpInbound(ctx context.Context, ip string) map[string]Inbound {
	out := map[string]Inbound{}
	var ni struct {
		Data struct {
			ASNs []string `json:"asns"`
		} `json:"data"`
	}
	if err := ripeJSON(ctx, "network-info/data.json?resource="+url.QueryEscape(ip), &ni); err != nil || len(ni.Data.ASNs) == 0 {
		return out
	}
	origin, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(ni.Data.ASNs[0]), "AS"))
	if err != nil {
		return out
	}
	var nb struct {
		Data struct {
			Neighbours []struct {
				ASN int `json:"asn"`
			} `json:"neighbours"`
		} `json:"data"`
	}
	_ = ripeJSON(ctx, fmt.Sprintf("asn-neighbours/data.json?resource=AS%d", origin), &nb)
	seen := map[int]bool{origin: true}
	for _, n := range nb.Data.Neighbours {
		seen[n.ASN] = true
	}
	ranks := map[string]int{}
	for asn := range seen {
		m, ok := cnNeighbors[asn]
		if !ok {
			continue
		}
		cur := out[m.carrier]
		cur.Carrier = m.carrier
		cur.Method = "bgp"
		cur.Via = append(cur.Via, fmt.Sprintf("AS%d", asn))
		if m.rank > ranks[m.carrier] {
			ranks[m.carrier] = m.rank
			cur.Label, cur.Premium = m.label, m.premium
		}
		out[m.carrier] = cur
	}
	return out
}
