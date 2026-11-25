package quality

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 流媒体 / AI 解锁检测，判定逻辑参考 xykt/IPQuality（独立实现）。
// "原生 / DNS" 用两个 DNS 启发式判断：解析到内网地址，或随机子域也能解析（泛解析，DNS 解锁常见特征）。

var (
	reNetflixRegion = regexp.MustCompile(`"id":"([A-Z]{2})","countryName"`)
	reYTRegion      = regexp.MustCompile(`"contentRegion":"([A-Z]{2})"`)
	rePrimeRegion   = regexp.MustCompile(`"currentTerritory":"([A-Z]{2})"`)
	reTikTokRegion  = regexp.MustCompile(`"region":"([A-Z]{2})"`)
	reRedditRegion  = regexp.MustCompile(`country="([A-Z]{2})"`)
	reTraceLoc      = regexp.MustCompile(`(?m)^loc=([A-Z]{2})`)
)

func checkUnlock(ctx context.Context) []Unlock {
	network := "tcp4"
	if selfIP(ctx, "tcp4") == "" {
		network = "tcp"
	}
	c := newClient(network, 15*time.Second, false)
	tests := []struct {
		name   string
		domain string
		fn     func(context.Context, *http.Client) Unlock
	}{
		{"Netflix", "netflix.com", netflix},
		{"YouTube Premium", "www.youtube.com", youtube},
		{"Disney+", "disneyplus.com", disney},
		{"Prime Video", "www.primevideo.com", prime},
		{"TikTok", "tiktok.com", tiktok},
		{"ChatGPT", "chat.openai.com", chatgpt},
		{"Reddit", "reddit.com", reddit},
	}
	out := make([]Unlock, len(tests))
	var wg sync.WaitGroup
	for i, t := range tests {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			u := t.fn(ctx, c)
			u.Name = t.name
			if u.Status == "yes" {
				native := !dnsSuspicious(ctx, t.domain)
				u.Native = &native
			}
			out[i] = u
		}(i)
	}
	wg.Wait()
	return out
}

func dnsSuspicious(ctx context.Context, domain string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var r net.Resolver
	if addrs, err := r.LookupIPAddr(ctx, domain); err == nil {
		for _, a := range addrs {
			if a.IP.IsPrivate() || a.IP.IsLoopback() || a.IP.IsLinkLocalUnicast() {
				return true
			}
		}
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	if addrs, err := r.LookupIPAddr(ctx, "probe-"+hex.EncodeToString(b)+"."+domain); err == nil && len(addrs) > 0 {
		return true
	}
	return false
}

func fail(note string) Unlock { return Unlock{Status: "fail", Note: note} }

func netflix(ctx context.Context, c *http.Client) Unlock {
	a, err1 := get(ctx, c, "https://www.netflix.com/title/81280792", nil) // 自制剧
	b, err2 := get(ctx, c, "https://www.netflix.com/title/70143836", nil) // 非自制剧
	if err1 != nil || err2 != nil {
		return fail("请求失败")
	}
	if a.Status == 403 && b.Status == 403 {
		return Unlock{Status: "no"}
	}
	region := find(reNetflixRegion, a.Body+b.Body)
	if region == "" {
		region = regionFromPath(b.URL)
	}
	if strings.Contains(a.Body, "Oh no!") && strings.Contains(b.Body, "Oh no!") {
		return Unlock{Status: "originals", Region: region}
	}
	if a.Status >= 400 && b.Status >= 400 {
		return Unlock{Status: "no", Region: region}
	}
	return Unlock{Status: "yes", Region: region}
}

func youtube(ctx context.Context, c *http.Client) Unlock {
	r, err := get(ctx, c, "https://www.youtube.com/premium", map[string]string{
		"Accept-Language": "en",
		"Cookie":          "CONSENT=YES+cb.20220301-11-p0.en+FX+700; PREF=hl=en",
	})
	if err != nil {
		return fail("请求失败")
	}
	switch {
	case strings.Contains(r.Body, "www.google.cn"):
		return Unlock{Status: "no", Region: "CN"}
	case strings.Contains(r.Body, "Premium is not available in your country"):
		return Unlock{Status: "no", Region: find(reYTRegion, r.Body), Note: "该地区不提供会员"}
	case strings.Contains(r.Body, "ad-free"):
		return Unlock{Status: "yes", Region: find(reYTRegion, r.Body)}
	}
	return fail("无法识别响应")
}

func disney(ctx context.Context, c *http.Client) Unlock {
	r, err := get(ctx, c, "https://www.disneyplus.com/", nil)
	if err != nil {
		return fail("请求失败")
	}
	if r.Status == 403 || strings.Contains(r.URL, "unavailable") {
		return Unlock{Status: "no"}
	}
	if strings.Contains(r.URL, "preview") {
		return Unlock{Status: "no", Note: "未开放地区"}
	}
	return Unlock{Status: "yes", Note: "网页可访问（简易检测）"}
}

func prime(ctx context.Context, c *http.Client) Unlock {
	r, err := get(ctx, c, "https://www.primevideo.com", nil)
	if err != nil {
		return fail("请求失败")
	}
	if region := find(rePrimeRegion, r.Body); region != "" {
		return Unlock{Status: "yes", Region: region}
	}
	return Unlock{Status: "no"}
}

func tiktok(ctx context.Context, c *http.Client) Unlock {
	r, err := get(ctx, c, "https://www.tiktok.com/", nil)
	if err != nil {
		return fail("请求失败")
	}
	if strings.Contains(r.Body, "Please wait...") {
		if r2, err := get(ctx, c, "https://www.tiktok.com/explore", nil); err == nil {
			r = r2
		}
	}
	if region := find(reTikTokRegion, r.Body); region != "" {
		return Unlock{Status: "yes", Region: region}
	}
	if r.Status == 403 {
		return Unlock{Status: "no"}
	}
	return fail("无法识别响应")
}

func chatgpt(ctx context.Context, c *http.Client) Unlock {
	r1, err1 := get(ctx, c, "https://api.openai.com/compliance/cookie_requirements", map[string]string{"Authorization": "Bearer null"})
	r2, err2 := get(ctx, c, "https://ios.chat.openai.com/", nil)
	if err1 != nil && err2 != nil {
		return fail("请求失败")
	}
	apiBlocked := err1 == nil && strings.Contains(r1.Body, "unsupported_country")
	if apiBlocked {
		// API 侧说不支持时，再看网页端是否真的拒绝
		if f, err := get(ctx, c, "https://chatgpt.com/favicon.ico", nil); err == nil && f.Status != 403 {
			apiBlocked = false
		}
	}
	appBlocked := err2 == nil && strings.Contains(r2.Body, "VPN")
	region := ""
	if t, err := get(ctx, c, "https://chat.openai.com/cdn-cgi/trace", nil); err == nil {
		region = find(reTraceLoc, t.Body)
	}
	switch {
	case !apiBlocked && !appBlocked:
		return Unlock{Status: "yes", Region: region}
	case apiBlocked && appBlocked:
		return Unlock{Status: "no", Region: region}
	case appBlocked:
		return Unlock{Status: "web", Region: region}
	default:
		return Unlock{Status: "app", Region: region}
	}
}

func reddit(ctx context.Context, c *http.Client) Unlock {
	r, err := get(ctx, c, "https://www.reddit.com/svc/shreddit/reddit-chat", map[string]string{
		"Referer": "https://www.reddit.com/", "Origin": "https://www.reddit.com",
		"Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
	})
	if err != nil {
		return fail("请求失败")
	}
	switch r.Status {
	case 200:
		return Unlock{Status: "yes", Region: find(reRedditRegion, r.Body)}
	case 403:
		return Unlock{Status: "no"}
	}
	return fail("HTTP " + http.StatusText(r.Status))
}

var rePathRegion = regexp.MustCompile(`^https?://[^/]+/([a-z]{2})(?:-[a-z]{2})?(?:/|$)`)

func regionFromPath(u string) string {
	return upper(find(rePathRegion, strings.ToLower(u)))
}
