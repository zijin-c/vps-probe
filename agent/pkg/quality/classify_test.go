package quality

import "testing"

func path(ips ...string) []Hop {
	hops := make([]Hop, len(ips))
	for i, ip := range ips {
		hops[i] = Hop{TTL: i + 1, IP: ip}
		hops[i].ASN, hops[i].Tag = lookupASN(ip)
	}
	return hops
}

func TestLookupASN(t *testing.T) {
	cases := map[string]string{
		"59.43.180.1":   "AS4809",
		"202.97.12.5":   "AS4134",
		"223.119.8.1":   "AS58807", // CMIN2
		"223.119.80.1":  "AS58453", // CMI
		"223.120.200.9": "AS58807",
		"61.14.200.1":   "AS10099",
		"61.140.1.1":    "", // 字符串前缀会误判，CIDR 不会
		"8.8.8.8":       "",
	}
	for ip, want := range cases {
		if got, _ := lookupASN(ip); got != want {
			t.Errorf("%s: got %q want %q", ip, got, want)
		}
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		carrier string
		hops    []Hop
		want    string
		premium bool
	}{
		{"电信", path("10.0.0.1", "59.43.1.1", "59.43.2.2", "219.141.140.10"), "CN2 GIA", true},
		{"电信", path("202.97.1.1", "202.97.3.3", "59.43.1.1", "59.43.2.2"), "CN2 GT", false},
		{"电信", path("202.97.1.1", "202.97.3.3", "219.141.140.10"), "163", false},
		{"联通", path("218.105.1.1", "219.158.1.1"), "9929", true},
		{"联通", path("219.158.1.1", "219.158.2.2"), "4837", false},
		{"移动", path("223.120.130.1", "221.183.1.1"), "CMIN2", true},
		{"移动", path("223.120.10.1", "221.183.1.1"), "CMI", false},
		{"移动", path("8.8.8.8"), "", false},
	}
	for _, c := range cases {
		got := classify(c.carrier, c.hops)
		if got.label != c.want || got.premium != c.premium {
			t.Errorf("%s %v: got %q/%v want %q/%v", c.carrier, c.hops, got.label, got.premium, c.want, c.premium)
		}
	}
}

func TestCombine(t *testing.T) {
	if got := combine("电信", nil); got.label != "未识别" {
		t.Fatalf("empty: %q", got.label)
	}
	gia := routeClass{"CN2 GIA", true, 5}
	gt := routeClass{"CN2 GT", false, 4}
	if got := combine("电信", []routeClass{gia, gia}); got != gia {
		t.Fatalf("same: %+v", got)
	}
	if got := combine("电信", []routeClass{gt, gia}); got.label != "CN2 GIA / 动态" || got.premium {
		t.Fatalf("mixed: %+v", got)
	}
}

func TestParseAbuserScore(t *testing.T) {
	s, l := parseAbuserScore("0.0039 (Low)")
	if l != "低风险" || s < 0.38 || s > 0.40 {
		t.Fatalf("got %v %q", s, l)
	}
}
