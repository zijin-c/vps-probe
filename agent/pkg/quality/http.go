package quality

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

// newClient 返回强制走指定协议栈（tcp4 / tcp6 / tcp）的 HTTP 客户端；不读取环境代理。
func newClient(network string, timeout time.Duration, insecure bool) *http.Client {
	d := &net.Dialer{Timeout: 8 * time.Second, KeepAlive: 30 * time.Second}
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
			return d.DialContext(ctx, network, addr)
		},
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 8 * time.Second,
		MaxIdleConns:        16,
		IdleConnTimeout:     30 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: insecure}, // #nosec G402 -- 仅在 Agent 配置 insecure_tls 时用于连接面板
	}
	return &http.Client{Timeout: timeout, Transport: tr}
}

type resp struct {
	Status int
	Body   string
	URL    string
}

// fetch 发一次请求，正文最多读 2 MiB。
func fetch(ctx context.Context, c *http.Client, method, url string, headers map[string]string, body io.Reader) (*resp, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	return &resp{Status: res.StatusCode, Body: string(b), URL: res.Request.URL.String()}, nil
}

func get(ctx context.Context, c *http.Client, url string, headers map[string]string) (*resp, error) {
	return fetch(ctx, c, http.MethodGet, url, headers, nil)
}

func find(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return m[1]
	}
	return ""
}

func upper(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }
