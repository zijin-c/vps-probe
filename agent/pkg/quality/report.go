// Package quality 是只读分支新增的"IP 质量 / 线路质量"检测。
//
// 所有检测都是 Agent 内置、固定的出站请求：查询公开 IP 数据库、访问流媒体站点、
// 对国内三网节点做 ICMP traceroute。面板只能要求"重新跑一遍内置检测"，
// 无法指定任何目标或命令。检测思路参考了 xykt/IPQuality 与
// oneclickvirt/backtrace（Apache-2.0）/ zhanghanyun/backtrace（MIT），代码为独立实现。
package quality

import (
	"context"
	"sync"
	"time"
)

type Source struct {
	Name      string   `json:"name"`
	Usage     string   `json:"usage,omitempty"`
	Company   string   `json:"company,omitempty"`
	Risk      *float64 `json:"risk,omitempty"`
	RiskLabel string   `json:"risk_label,omitempty"`
	Flags     []string `json:"flags,omitempty"`
}

type IPInfo struct {
	IP         string   `json:"ip"`
	ASN        string   `json:"asn,omitempty"`
	Org        string   `json:"org,omitempty"`
	Country    string   `json:"country,omitempty"`
	RegCountry string   `json:"reg_country,omitempty"`
	City       string   `json:"city,omitempty"`
	IPType     string   `json:"ip_type,omitempty"` // native / broadcast
	Sources    []Source `json:"sources,omitempty"`
}

type Unlock struct {
	Name   string `json:"name"`
	Status string `json:"status"` // yes / no / originals / web / app / fail
	Region string `json:"region,omitempty"`
	Native *bool  `json:"native,omitempty"`
	Note   string `json:"note,omitempty"`
}

type Hop struct {
	TTL int     `json:"ttl"`
	IP  string  `json:"ip,omitempty"`
	RTT float64 `json:"rtt,omitempty"`
	ASN string  `json:"asn,omitempty"`
	Tag string  `json:"tag,omitempty"`
}

type Route struct {
	Carrier string  `json:"carrier"`
	City    string  `json:"city,omitempty"`
	Target  string  `json:"target,omitempty"`
	Label   string  `json:"label"`
	Premium bool    `json:"premium,omitempty"`
	RTT     float64 `json:"rtt,omitempty"`
	Hops    []Hop   `json:"hops,omitempty"`
}

type Report struct {
	Parts        []string `json:"parts"` // 本次实际执行的分项，面板据此合并
	AgentVersion string   `json:"agent_version,omitempty"`
	IPv4         *IPInfo  `json:"ipv4,omitempty"`
	IPv6         *IPInfo  `json:"ipv6,omitempty"`
	Unlock       []Unlock `json:"unlock,omitempty"`
	RoutesV4     []Route  `json:"routes_v4,omitempty"`
	Error        string   `json:"error,omitempty"`
	TookSeconds  int      `json:"took_seconds,omitempty"`
}

// Keys 是面板下发的可选数据源密钥（在面板 probe.yaml 中配置）。
type Keys struct {
	IPInfo      string `json:"ipinfo,omitempty"`
	AbuseIPDB   string `json:"abuseipdb,omitempty"`
	IP2Location string `json:"ip2location,omitempty"`
}

// 检测分项：面板可以只要求重跑其中几项
const (
	PartIP     = "ip"
	PartUnlock = "unlock"
	PartRoute  = "route"
)

var AllParts = []string{PartIP, PartUnlock, PartRoute}

// Run 执行指定分项的检测（parts 为空表示全部），整体限时 3 分钟。
func Run(parent context.Context, keys Keys, version string, parts []string) *Report {
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	start := time.Now()
	if len(parts) == 0 {
		parts = AllParts
	}
	want := map[string]bool{}
	for _, p := range parts {
		want[p] = true
	}
	r := &Report{AgentVersion: version}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs []string
	addErr := func(s string) { mu.Lock(); errs = append(errs, s); mu.Unlock() }

	if want[PartIP] {
		r.Parts = append(r.Parts, PartIP)
		wg.Add(2)
		go func() { defer wg.Done(); r.IPv4 = checkIP(ctx, "tcp4", keys) }()
		go func() { defer wg.Done(); r.IPv6 = checkIP(ctx, "tcp6", keys) }()
	}
	if want[PartUnlock] {
		r.Parts = append(r.Parts, PartUnlock)
		wg.Add(1)
		go func() { defer wg.Done(); r.Unlock = checkUnlock(ctx) }()
	}
	if want[PartRoute] {
		r.Parts = append(r.Parts, PartRoute)
		wg.Add(1)
		go func() {
			defer wg.Done()
			routes, err := checkRoutes(ctx)
			if err != nil {
				addErr(err.Error())
			}
			r.RoutesV4 = routes
		}()
	}
	wg.Wait()

	if len(errs) > 0 {
		r.Error = errs[0]
	}
	r.TookSeconds = int(time.Since(start).Seconds())
	return r
}
