package probe

import (
	"slices"
	"testing"
	"time"
)

func resetQuality(t *testing.T) {
	t.Helper()
	dataDir = t.TempDir()
	qualityData = nil
	qualityPending = map[uint64]map[string]time.Time{}
	qualityRunning = map[uint64]running{}
}

func runParts(id uint64) []string {
	return QualitySchedule(id)["run"].([]string)
}

func TestQualityScheduleAndMerge(t *testing.T) {
	resetQuality(t)

	// 首次：三项都该跑；领取后在上报前不重复下发
	if got := runParts(1); !slices.Equal(got, allParts) {
		t.Fatalf("first run = %v", got)
	}
	if got := runParts(1); len(got) != 0 {
		t.Fatalf("while running = %v", got)
	}

	full := `{"parts":["ip","unlock","route"],"ipv4":{"ip":"203.0.113.9","ip_type":"native"},
	  "unlock":[{"name":"Netflix","status":"yes","region":"US"}],
	  "routes_v4":[{"carrier":"电信","label":"CN2 GIA","premium":true},{"carrier":"电信","label":"CN2 GIA","premium":true},{"carrier":"电信","label":"163"},{"carrier":"联通","label":"超时"}]}`
	if err := SaveQuality(1, []byte(full)); err != nil {
		t.Fatal(err)
	}
	if got := runParts(1); len(got) != 0 {
		t.Fatalf("after report = %v", got)
	}

	// 手动只重测解锁：只下发 unlock，部分上报不应清掉其它分项
	RequestQualityRefresh(1, []string{"unlock", "bogus"})
	if st := GetQuality(1, false)["status"].(map[string]any); !slices.Equal(st["pending"].([]string), []string{"unlock"}) {
		t.Fatalf("pending = %v", st)
	}
	if got := runParts(1); !slices.Equal(got, []string{"unlock"}) {
		t.Fatalf("manual run = %v", got)
	}
	if err := SaveQuality(1, []byte(`{"parts":["unlock"],"unlock":[{"name":"Netflix","status":"originals"}]}`)); err != nil {
		t.Fatal(err)
	}
	q := GetQuality(1, true)
	if q["ipv4"].(map[string]any)["ip"] != "203.0.*.*" {
		t.Fatalf("guest ip not masked: %v", q["ipv4"])
	}
	if q["unlock"].([]any)[0].(map[string]any)["status"] != "originals" {
		t.Fatalf("unlock not merged: %v", q["unlock"])
	}
	if _, ok := q["routes_v4"]; !ok {
		t.Fatal("routes lost after partial report")
	}

	// 摘要：每家运营商取出现最多的线路，超时不计
	b := QualitySummaries([]uint64{1, 2})[1]
	if r := b.Routes["电信"]; r.Label != "CN2 GIA" || !r.Premium {
		t.Fatalf("summary 电信 = %+v", r)
	}
	if _, ok := b.Routes["联通"]; ok {
		t.Fatalf("timeout should be skipped: %+v", b.Routes)
	}
	if b.IPType != "native" {
		t.Fatalf("ip type = %q", b.IPType)
	}

	// 重新加载文件后数据仍在
	qualityData = nil
	if _, ok := GetQuality(1, false)["unlock"]; !ok {
		t.Fatal("not persisted")
	}
}

func TestQualityLegacyEntry(t *testing.T) {
	resetQuality(t)
	// 旧 Agent 不带 parts：视为三项全部
	if err := SaveQuality(3, []byte(`{"ipv4":{"ip":"1.2.3.4"},"error":"回程检测需要 root 权限"}`)); err != nil {
		t.Fatal(err)
	}
	q := GetQuality(3, false)
	if q["error"] != "回程检测需要 root 权限" {
		t.Fatalf("error = %v", q["error"])
	}
	if len(q["parts_at"].(map[string]string)) != 3 {
		t.Fatalf("parts_at = %v", q["parts_at"])
	}
}
