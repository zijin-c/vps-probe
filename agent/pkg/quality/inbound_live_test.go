package quality

import (
	"context"
	"os"
	"testing"
	"time"
)

// 联网测试：QUALITY_LIVE=1 go test -run TestInboundLive ./pkg/quality -v
func TestInboundLive(t *testing.T) {
	if os.Getenv("QUALITY_LIVE") != "1" {
		t.Skip("set QUALITY_LIVE=1 to run")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	target := os.Getenv("QUALITY_TARGET")
	if target == "" {
		target = "1.1.1.1"
	}
	for _, c := range inboundCarriers {
		in, ok := probeInbound(ctx, target, c.name, c.magic[0])
		named := 0
		for _, h := range in.Hops {
			if h.IP != "" {
				named++
			}
		}
		t.Logf("%s ok=%v label=%q premium=%v city=%q hops=%d named=%d rtt=%.1f", c.name, ok, in.Label, in.Premium, in.City, len(in.Hops), named, in.RTT)
		for _, h := range in.Hops {
			if h.ASN != "" {
				t.Logf("   ttl=%d %s %s %s", h.TTL, h.IP, h.ASN, h.Tag)
			}
		}
	}
	bgp := bgpInbound(ctx, target)
	t.Logf("bgp: %+v", bgp)
}
