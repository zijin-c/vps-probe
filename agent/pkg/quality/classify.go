package quality

import (
	"fmt"
	"net/netip"
)

// 国内骨干网前缀 → ASN。前缀事实参考 oneclickvirt/backtrace（Apache-2.0），
// 这里改为严格的 CIDR 匹配（原实现的字符串前缀会把 61.140.x 误判成 61.14.x）。
type asnPrefix struct {
	asn    string
	tag    string
	prefix netip.Prefix
}

var asnTable = func() []asnPrefix {
	var t []asnPrefix
	add := func(asn, tag string, cidrs ...string) {
		for _, c := range cidrs {
			t = append(t, asnPrefix{asn, tag, netip.MustParsePrefix(c)})
		}
	}
	// 移动 CMIN2 必须排在 CMI 之前（同属 223.118~121 段）
	cmin2 := []string{"223.118.32.0/24", "223.120.128.0/17"}
	for _, n := range []int{8, 9, 10, 11, 12, 13, 14, 15, 26, 27, 28, 29, 32, 33, 34, 35, 36, 37, 74, 75, 88, 89, 100, 252, 253} {
		cmin2 = append(cmin2, fmt.Sprintf("223.119.%d.0/24", n))
	}
	add("AS58807", "CMIN2", cmin2...)
	add("AS4809", "CN2", "59.43.0.0/16")
	add("AS4134", "163", "202.97.0.0/16")
	add("AS9929", "9929", "218.105.0.0/16", "210.51.0.0/16")
	add("AS10099", "CUG", "202.77.0.0/16", "43.252.0.0/16", "61.14.0.0/16")
	add("AS4837", "4837", "219.158.0.0/16")
	add("AS58453", "CMI", "223.118.0.0/15", "223.120.0.0/15")
	add("AS9808", "CMNET", "221.183.0.0/16", "111.24.0.0/16")
	add("AS23764", "CTGNet", "69.194.0.0/16", "203.22.0.0/16")
	return t
}()

func lookupASN(ip string) (asn, tag string) {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return "", ""
	}
	for _, p := range asnTable {
		if p.prefix.Contains(a) {
			return p.asn, p.tag
		}
	}
	return "", ""
}

type routeClass struct {
	label   string
	premium bool
	rank    int // 越大越"确定"
}

// classify 按途经骨干网判定一条路径（逻辑参考 oneclickvirt/backtrace 的 route_classification）。
func classify(carrier string, hops []Hop) routeClass {
	first := map[string]int{}
	count := map[string]int{}
	for i, h := range hops {
		if h.ASN == "" {
			continue
		}
		if _, ok := first[h.ASN]; !ok {
			first[h.ASN] = i
		}
		count[h.ASN]++
	}
	has := func(a string) bool { return count[a] > 0 }
	before := func(a, b string) bool { return has(a) && has(b) && first[a] < first[b] }

	switch carrier {
	case "电信":
		if has("AS4809") {
			switch {
			case count["AS4809"] < 2:
				return routeClass{"CN2 混合", false, 2}
			case !has("AS4134") || (first["AS4809"] < first["AS4134"] && count["AS4134"] <= 1):
				return routeClass{"CN2 GIA", true, 5}
			case before("AS4134", "AS4809"):
				return routeClass{"CN2 GT", false, 4}
			default:
				return routeClass{"CN2 混合", false, 3}
			}
		}
		if has("AS23764") {
			return routeClass{"CTGNet", true, 4}
		}
		if count["AS4134"] >= 2 {
			return routeClass{"163", false, 4}
		}
	case "联通":
		if has("AS9929") {
			if before("AS4837", "AS9929") {
				return routeClass{"9929 混合", false, 3}
			}
			return routeClass{"9929", true, 5}
		}
		if has("AS10099") {
			return routeClass{"CUG", true, 3}
		}
		if count["AS4837"] >= 2 {
			return routeClass{"4837", false, 4}
		}
	case "移动":
		if has("AS58807") {
			if before("AS58453", "AS58807") {
				return routeClass{"CMIN2 混合", false, 3}
			}
			return routeClass{"CMIN2", true, 5}
		}
		if has("AS58453") {
			return routeClass{"CMI", false, 4}
		}
		if has("AS9808") {
			return routeClass{"CMNET", false, 3}
		}
	}
	return routeClass{}
}

// combine 汇总多次追踪的分类：一致则采用，不一致标记为动态混合。
func combine(carrier string, cs []routeClass) routeClass {
	if len(cs) == 0 {
		return routeClass{label: "未识别"}
	}
	same := true
	for _, c := range cs[1:] {
		if c.label != cs[0].label {
			same = false
			break
		}
	}
	if same {
		return cs[0]
	}
	// 多次结果不一致：取最"确定"的一个作为主标签并注明混合
	best := cs[0]
	for _, c := range cs[1:] {
		if c.rank > best.rank {
			best = c
		}
	}
	return routeClass{label: best.label + " / 动态", premium: false, rank: best.rank}
}
