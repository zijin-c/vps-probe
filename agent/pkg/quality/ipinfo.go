package quality

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// 使用类型统一成中文标签（与 IPQuality 的 stype 对应）
var usageNames = map[string]string{
	"business": "商业", "isp": "家宽", "lineisp": "家宽", "hosting": "机房", "education": "教育",
	"government": "政府", "banking": "银行", "organization": "组织", "military": "军队",
	"library": "图书馆", "cdn": "CDN", "mobile": "手机", "spider": "蜘蛛", "reserved": "保留",
}

func usageName(raw string) string {
	r := strings.ToLower(strings.TrimSpace(raw))
	if r == "" {
		return ""
	}
	if v, ok := usageNames[r]; ok {
		return v
	}
	return "其他"
}

// selfIP 通过强制协议栈访问"我的 IP"服务得到出口地址。
func selfIP(ctx context.Context, network string) string {
	c := newClient(network, 6*time.Second, false)
	for _, u := range []string{"https://api64.ipify.org", "https://icanhazip.com", "https://ifconfig.co/ip", "https://ident.me"} {
		r, err := get(ctx, c, u, map[string]string{"Accept": "text/plain"})
		if err != nil || r.Status != 200 {
			continue
		}
		ip := net.ParseIP(strings.TrimSpace(r.Body))
		if ip == nil {
			continue
		}
		if (network == "tcp4") != (ip.To4() != nil) {
			continue
		}
		return ip.String()
	}
	return ""
}

func checkIP(ctx context.Context, network string, keys Keys) *IPInfo {
	ip := selfIP(ctx, network)
	if ip == "" {
		return nil
	}
	info := &IPInfo{IP: ip}
	c := newClient("tcp", 12*time.Second, false)
	esc := url.PathEscape(ip)

	var geoCountry string

	// 1) ipapi.is：使用类型、公司类型、滥用评分、各类风险标记（免费额度，无需密钥）
	if r, err := get(ctx, c, "https://api.ipapi.is/?q="+url.QueryEscape(ip), nil); err == nil && r.Status == 200 {
		var v struct {
			RIR          string `json:"rir"`
			IsMobile     bool   `json:"is_mobile"`
			IsCrawler    bool   `json:"is_crawler"`
			IsDatacenter bool   `json:"is_datacenter"`
			IsTor        bool   `json:"is_tor"`
			IsProxy      bool   `json:"is_proxy"`
			IsVPN        bool   `json:"is_vpn"`
			IsAbuser     bool   `json:"is_abuser"`
			Company      struct {
				Name        string `json:"name"`
				Type        string `json:"type"`
				AbuserScore string `json:"abuser_score"`
			} `json:"company"`
			ASN struct {
				ASN  int    `json:"asn"`
				Org  string `json:"org"`
				Type string `json:"type"`
			} `json:"asn"`
			Location struct {
				CountryCode string `json:"country_code"`
				City        string `json:"city"`
			} `json:"location"`
		}
		if json.Unmarshal([]byte(r.Body), &v) == nil {
			s := Source{Name: "ipapi.is", Usage: usageName(v.ASN.Type), Company: usageName(v.Company.Type)}
			if v.IsMobile {
				s.Usage = "手机"
			}
			if score, label := parseAbuserScore(v.Company.AbuserScore); label != "" {
				s.Risk, s.RiskLabel = &score, label
			}
			s.Flags = flags(map[string]bool{"proxy": v.IsProxy, "vpn": v.IsVPN, "tor": v.IsTor, "hosting": v.IsDatacenter, "abuser": v.IsAbuser, "bot": v.IsCrawler})
			info.Sources = append(info.Sources, s)
			if v.ASN.ASN > 0 {
				info.ASN = fmt.Sprintf("AS%d", v.ASN.ASN)
			}
			info.Org = firstNonEmpty(v.ASN.Org, v.Company.Name)
			geoCountry = upper(v.Location.CountryCode)
			info.City = v.Location.City
		}
	}

	// 2) ip-api.com：机房 / 手机 / 代理（免费、非商用、HTTP）
	if r, err := get(ctx, c, "http://ip-api.com/json/"+esc+"?fields=status,countryCode,city,isp,org,as,mobile,proxy,hosting", nil); err == nil && r.Status == 200 {
		var v struct {
			Status      string `json:"status"`
			CountryCode string `json:"countryCode"`
			City        string `json:"city"`
			Org         string `json:"org"`
			AS          string `json:"as"`
			Mobile      bool   `json:"mobile"`
			Proxy       bool   `json:"proxy"`
			Hosting     bool   `json:"hosting"`
		}
		if json.Unmarshal([]byte(r.Body), &v) == nil && v.Status == "success" {
			usage := "家宽"
			if v.Hosting {
				usage = "机房"
			} else if v.Mobile {
				usage = "手机"
			}
			info.Sources = append(info.Sources, Source{Name: "ip-api", Usage: usage, Flags: flags(map[string]bool{"proxy": v.Proxy, "hosting": v.Hosting})})
			if geoCountry == "" {
				geoCountry = upper(v.CountryCode)
			}
			if info.City == "" {
				info.City = v.City
			}
			if info.ASN == "" && v.AS != "" {
				info.ASN = strings.Fields(v.AS)[0]
			}
			if info.Org == "" {
				info.Org = v.Org
			}
		}
	}

	// 3) ipinfo.io：地理位置；配置了 token 时额外有使用类型与隐私标记
	ipinfoURL := "https://ipinfo.io/" + esc + "/json"
	if keys.IPInfo != "" {
		ipinfoURL += "?token=" + url.QueryEscape(keys.IPInfo)
	}
	if r, err := get(ctx, c, ipinfoURL, map[string]string{"Accept": "application/json"}); err == nil && r.Status == 200 {
		var v struct {
			Country string `json:"country"`
			City    string `json:"city"`
			Org     string `json:"org"`
			ASN     *struct {
				Type string `json:"type"`
			} `json:"asn"`
			Company *struct {
				Type string `json:"type"`
			} `json:"company"`
			Privacy *struct {
				VPN     bool `json:"vpn"`
				Proxy   bool `json:"proxy"`
				Tor     bool `json:"tor"`
				Relay   bool `json:"relay"`
				Hosting bool `json:"hosting"`
			} `json:"privacy"`
		}
		if json.Unmarshal([]byte(r.Body), &v) == nil {
			if v.ASN != nil || v.Company != nil || v.Privacy != nil {
				s := Source{Name: "ipinfo"}
				if v.ASN != nil {
					s.Usage = usageName(v.ASN.Type)
				}
				if v.Company != nil {
					s.Company = usageName(v.Company.Type)
				}
				if p := v.Privacy; p != nil {
					s.Flags = flags(map[string]bool{"vpn": p.VPN, "proxy": p.Proxy, "tor": p.Tor, "relay": p.Relay, "hosting": p.Hosting})
				}
				info.Sources = append(info.Sources, s)
			}
			if geoCountry == "" {
				geoCountry = upper(v.Country)
			}
			if info.Org == "" && v.Org != "" {
				info.Org = v.Org
			}
		}
	}

	// 4) 可选：AbuseIPDB（需要免费密钥）
	if keys.AbuseIPDB != "" {
		r, err := get(ctx, c, "https://api.abuseipdb.com/api/v2/check?maxAgeInDays=90&ipAddress="+url.QueryEscape(ip),
			map[string]string{"Key": keys.AbuseIPDB, "Accept": "application/json"})
		if err == nil && r.Status == 200 {
			var v struct {
				Data struct {
					UsageType            string `json:"usageType"`
					AbuseConfidenceScore *int   `json:"abuseConfidenceScore"`
				} `json:"data"`
			}
			if json.Unmarshal([]byte(r.Body), &v) == nil {
				s := Source{Name: "AbuseIPDB", Usage: abuseUsage(v.Data.UsageType)}
				if v.Data.AbuseConfidenceScore != nil {
					score := float64(*v.Data.AbuseConfidenceScore)
					s.Risk = &score
					s.RiskLabel = band(score, []float64{25, 75}, []string{"低风险", "高风险", "建议封禁"})
				}
				info.Sources = append(info.Sources, s)
			}
		}
	}

	// 5) 可选：IP2Location.io（需要密钥）
	if keys.IP2Location != "" {
		r, err := get(ctx, c, "https://api.ip2location.io/?key="+url.QueryEscape(keys.IP2Location)+"&ip="+url.QueryEscape(ip), nil)
		if err == nil && r.Status == 200 {
			var v struct {
				UsageType  string `json:"usage_type"`
				FraudScore *int   `json:"fraud_score"`
				IsProxy    bool   `json:"is_proxy"`
				ASUsage    string `json:"as_usage_type"`
			}
			if json.Unmarshal([]byte(r.Body), &v) == nil {
				s := Source{Name: "IP2Location", Usage: ip2lUsage(v.UsageType), Company: ip2lUsage(v.ASUsage), Flags: flags(map[string]bool{"proxy": v.IsProxy})}
				if v.FraudScore != nil {
					score := float64(*v.FraudScore)
					s.Risk = &score
					s.RiskLabel = band(score, []float64{33, 66}, []string{"低风险", "中风险", "高风险"})
				}
				info.Sources = append(info.Sources, s)
			}
		}
	}

	// 原生 / 广播：注册国家（RDAP，来自 RIR）与地理位置国家是否一致
	info.Country = geoCountry
	info.RegCountry = rdapCountry(ctx, ip)
	if info.Country != "" && info.RegCountry != "" {
		if info.Country == info.RegCountry {
			info.IPType = "native"
		} else {
			info.IPType = "broadcast"
		}
	}
	return info
}

func rdapCountry(ctx context.Context, ip string) string {
	client := newClient("tcp", 12*time.Second, false)
	r, err := get(ctx, client, "https://rdap.org/ip/"+url.PathEscape(ip), map[string]string{"Accept": "application/rdap+json"})
	if err != nil || r.Status != 200 {
		return ""
	}
	var v struct {
		Country string `json:"country"`
	}
	if json.Unmarshal([]byte(r.Body), &v) != nil {
		return ""
	}
	return upper(v.Country)
}

var scoreRe = regexp.MustCompile(`^\s*([0-9.]+)\s*(?:\(([^)]*)\))?`)

// "0.0039 (Low)" → 0.39, "低风险"
func parseAbuserScore(s string) (float64, string) {
	m := scoreRe.FindStringSubmatch(s)
	if m == nil {
		return 0, ""
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, ""
	}
	labels := map[string]string{"very low": "极低风险", "low": "低风险", "elevated": "中风险", "medium": "中风险", "high": "高风险", "very high": "极高风险"}
	label := labels[strings.ToLower(strings.TrimSpace(m[2]))]
	if label == "" {
		label = band(f*100, []float64{1, 5, 30}, []string{"低风险", "中风险", "高风险", "极高风险"})
	}
	return f * 100, label
}

func band(v float64, cuts []float64, labels []string) string {
	for i, c := range cuts {
		if v < c {
			return labels[i]
		}
	}
	return labels[len(labels)-1]
}

func flags(m map[string]bool) []string {
	var out []string
	for _, k := range []string{"proxy", "vpn", "tor", "relay", "hosting", "abuser", "bot"} {
		if m[k] {
			out = append(out, k)
		}
	}
	return out
}

func abuseUsage(s string) string {
	switch s {
	case "Data Center/Web Hosting/Transit":
		return "机房"
	case "Fixed Line ISP":
		return "家宽"
	case "Mobile ISP":
		return "手机"
	case "Commercial":
		return "商业"
	case "University/College/School":
		return "教育"
	case "Government":
		return "政府"
	case "Content Delivery Network":
		return "CDN"
	case "":
		return ""
	}
	return "其他"
}

func ip2lUsage(s string) string {
	code := strings.ToUpper(strings.SplitN(s, "/", 2)[0])
	m := map[string]string{"COM": "商业", "DCH": "机房", "EDU": "教育", "GOV": "政府", "ORG": "组织", "MIL": "军队", "LIB": "图书馆", "CDN": "CDN", "ISP": "家宽", "MOB": "手机", "SES": "蜘蛛", "RSV": "保留"}
	if code == "" {
		return ""
	}
	if v, ok := m[code]; ok {
		return v
	}
	return "其他"
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			return x
		}
	}
	return ""
}
