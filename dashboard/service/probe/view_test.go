package probe

import (
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

func TestParseBilling(t *testing.T) {
	singleton.Loc = time.FixedZone("CST", 8*3600)
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, singleton.Loc)

	s := &model.Server{PublicNote: `{"billingDataMod":{"startDate":"2025-12-20T00:00:00+08:00","endDate":"2026-12-20T00:00:00+08:00","autoRenewal":"0","cycle":"Year","amount":"$10"},"planDataMod":{"networkRoute":"CN2 GIA"}}`}
	b := ParseBilling(s, now)
	if !b.Known || b.CycleMonths != 12 || b.Route != "CN2 GIA" {
		t.Fatalf("unexpected billing: %+v", b)
	}
	if d := b.DaysLeft(now); d != 25 {
		t.Fatalf("days left = %d, want 25", d)
	}
	if v := b.RemainingValue(now); !strings.HasPrefix(v, "$0.6") {
		t.Fatalf("remaining value = %q", v)
	}

	// 自动续费：过期的到期日应滚动到未来
	s.PublicNote = `{"billingDataMod":{"endDate":"2026-01-10T00:00:00+08:00","autoRenewal":"1","cycle":"月","amount":"¥15"}}`
	b = ParseBilling(s, now)
	if b.End.Before(now) || b.End.Month() != time.December || b.End.Day() != 10 {
		t.Fatalf("auto renewal end = %v", b.End)
	}

	s.PublicNote = `{"billingDataMod":{"endDate":"0000-00-00T23:59:59+08:00","amount":"$0"}}`
	if b = ParseBilling(s, now); !b.Permanent {
		t.Fatalf("expected permanent: %+v", b)
	}

	s.PublicNote = "普通备注"
	if b = ParseBilling(s, now); b.Known {
		t.Fatalf("plain note should be unknown")
	}

	out := renderExpire([]ServerView{{Name: "LA<Mini>", Billing: ParseBilling(&model.Server{PublicNote: `{"billingDataMod":{"endDate":"2026-12-01","cycle":"Year","amount":"$10"}}`}, now)}}, now)
	if !strings.Contains(out, "LA&lt;Mini&gt;") || !strings.Contains(out, "剩 6 天") {
		t.Fatalf("render: %s", out)
	}
}
