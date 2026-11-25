package quality

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"sort"
	"sync"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

// 回程目标：北京 / 上海 / 广州 × 电信 / 联通 / 移动。
// IP 取自 zhanghanyun/backtrace（MIT）与 oneclickvirt/backtrace（Apache-2.0）公开的目标列表。
var routeTargets = []struct{ City, Carrier, IP string }{
	{"北京", "电信", "219.141.140.10"}, {"北京", "联通", "202.106.195.68"}, {"北京", "移动", "221.179.155.161"},
	{"上海", "电信", "202.96.209.133"}, {"上海", "联通", "210.22.97.1"}, {"上海", "移动", "211.136.112.200"},
	{"广州", "电信", "58.60.188.222"}, {"广州", "联通", "210.21.196.6"}, {"广州", "移动", "120.196.165.24"},
}

const (
	maxHops      = 30
	traceTimeout = 2500 * time.Millisecond
	attempts     = 3
)

var errNoRaw = errors.New("回程检测需要 root 权限（原始 ICMP 套接字）")

func checkRoutes(ctx context.Context) ([]Route, error) {
	// 先确认能打开原始套接字
	probe, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return nil, errNoRaw
	}
	probe.Close()

	out := make([]Route, len(routeTargets))
	var wg sync.WaitGroup
	base := os.Getpid() & 0x3fff
	for i, t := range routeTargets {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			var runs [][]Hop
			for a := 0; a < attempts && ctx.Err() == nil; a++ {
				id := (base + i*attempts + a + 1) & 0xffff
				hops, err := traceOnce(net.ParseIP(t.IP), id)
				if err == nil && len(hops) > 0 {
					runs = append(runs, hops)
				}
				time.Sleep(200 * time.Millisecond)
			}
			out[i] = buildRoute(t.City, t.Carrier, t.IP, runs)
		}(i)
	}
	wg.Wait()
	return out, nil
}

// traceOnce 一次性发出 TTL 1..30 的 ICMP Echo（Seq = TTL），然后在超时内收集回包。
func traceOnce(target net.IP, id int) ([]Hop, error) {
	c, err := icmp.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return nil, err
	}
	defer c.Close()
	pc := c.IPv4PacketConn()
	dst := target.To4()

	var mu sync.Mutex
	sent := make([]time.Time, maxHops+1)
	found := map[int]Hop{}
	destTTL := 0

	deadline := time.Now().Add(traceTimeout + maxHops*15*time.Millisecond)
	_ = c.SetReadDeadline(deadline)
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 1500)
		for {
			n, peer, err := c.ReadFrom(buf)
			if err != nil {
				return
			}
			now := time.Now()
			m, err := icmp.ParseMessage(1, buf[:n])
			if err != nil {
				continue
			}
			ttl := 0
			reached := false
			switch body := m.Body.(type) {
			case *icmp.TimeExceeded:
				ttl = innerSeq(body.Data, dst, id)
			case *icmp.DstUnreach:
				ttl = innerSeq(body.Data, dst, id)
				reached = true
			case *icmp.Echo:
				if m.Type == ipv4.ICMPTypeEchoReply && body.ID == id {
					ttl = body.Seq
					reached = true
				}
			}
			if ttl < 1 || ttl > maxHops {
				continue
			}
			ip := peer.String()
			if a, ok := peer.(*net.IPAddr); ok {
				ip = a.IP.String()
			}
			mu.Lock()
			if _, dup := found[ttl]; !dup {
				found[ttl] = Hop{TTL: ttl, IP: ip, RTT: float64(now.Sub(sent[ttl]).Microseconds()) / 1000}
			}
			if reached && (destTTL == 0 || ttl < destTTL) {
				destTTL = ttl
			}
			mu.Unlock()
		}
	}()

	for ttl := 1; ttl <= maxHops; ttl++ {
		mu.Lock()
		stop := destTTL != 0 && ttl > destTTL
		mu.Unlock()
		if stop {
			break
		}
		if err := pc.SetTTL(ttl); err != nil {
			return nil, err
		}
		msg := icmp.Message{Type: ipv4.ICMPTypeEcho, Body: &icmp.Echo{ID: id, Seq: ttl, Data: []byte("vps-probe")}}
		b, _ := msg.Marshal(nil)
		mu.Lock()
		sent[ttl] = time.Now()
		mu.Unlock()
		if _, err := c.WriteTo(b, &net.IPAddr{IP: dst}); err != nil {
			return nil, err
		}
		time.Sleep(15 * time.Millisecond)
	}
	<-done

	mu.Lock()
	defer mu.Unlock()
	last := destTTL
	if last == 0 {
		for t := range found {
			if t > last {
				last = t
			}
		}
	}
	var hops []Hop
	for t := 1; t <= last; t++ {
		if h, ok := found[t]; ok {
			hops = append(hops, h)
		} else {
			hops = append(hops, Hop{TTL: t})
		}
	}
	return hops, nil
}

// innerSeq 从 ICMP 差错报文中引用的原始 IPv4 头 + ICMP 头里取出我们的 Seq（=TTL）。
func innerSeq(data []byte, dst net.IP, id int) int {
	if len(data) < 20 {
		return 0
	}
	ihl := int(data[0]&0x0f) * 4
	if ihl < 20 || len(data) < ihl+8 {
		return 0
	}
	if !net.IP(data[16:20]).Equal(dst) {
		return 0
	}
	if int(binary.BigEndian.Uint16(data[ihl+4:])) != id {
		return 0
	}
	return int(binary.BigEndian.Uint16(data[ihl+6:]))
}

// buildRoute 合并多次追踪：每一跳取出现次数最多的 IP，并对每次结果分别分类后汇总。
func buildRoute(city, carrier, target string, runs [][]Hop) Route {
	r := Route{Carrier: carrier, City: city, Target: target, Label: "未知"}
	if len(runs) == 0 {
		r.Label = "超时"
		return r
	}
	merged := mergeRuns(runs)
	for i := range merged {
		merged[i].ASN, merged[i].Tag = lookupASN(merged[i].IP)
	}
	var labels []routeClass
	for _, run := range runs {
		for i := range run {
			run[i].ASN, _ = lookupASN(run[i].IP)
		}
		if c := classify(carrier, run); c.label != "" {
			labels = append(labels, c)
		}
	}
	if c := classify(carrier, merged); c.label != "" {
		labels = append(labels, c)
	}
	final := combine(carrier, labels)
	r.Label, r.Premium = final.label, final.premium
	r.Hops = merged
	for i := len(merged) - 1; i >= 0; i-- {
		if merged[i].RTT > 0 {
			r.RTT = merged[i].RTT
			break
		}
	}
	return r
}

func mergeRuns(runs [][]Hop) []Hop {
	maxLen := 0
	for _, r := range runs {
		if len(r) > maxLen {
			maxLen = len(r)
		}
	}
	out := make([]Hop, 0, maxLen)
	for i := 0; i < maxLen; i++ {
		count := map[string]int{}
		rtts := map[string][]float64{}
		for _, r := range runs {
			if i < len(r) && r[i].IP != "" {
				count[r[i].IP]++
				rtts[r[i].IP] = append(rtts[r[i].IP], r[i].RTT)
			}
		}
		h := Hop{TTL: i + 1}
		best := 0
		keys := make([]string, 0, len(count))
		for k := range count {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, ip := range keys {
			if count[ip] > best {
				best, h.IP = count[ip], ip
			}
		}
		if h.IP != "" {
			ts := rtts[h.IP]
			sort.Float64s(ts)
			h.RTT = ts[len(ts)/2]
		}
		out = append(out, h)
	}
	return out
}
