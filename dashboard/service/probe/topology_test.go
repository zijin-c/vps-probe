package probe

import (
	"os"
	"testing"
)

func withTempDataDir(t *testing.T) {
	t.Helper()
	old := dataDir
	dataDir = t.TempDir()
	topoData, acctLoad, acctData = nil, false, nil
	t.Cleanup(func() { dataDir = old; topoData, acctLoad, acctData = nil, false, nil })
}

func TestSaveTopologyValidates(t *testing.T) {
	withTempDataDir(t)
	good := Topology{
		Nodes: []TopoNode{
			{ID: "a", Label: "入口", Role: "entry", Region: "hk", X: 5000, Y: -3},
			{ID: "b", Label: "落地", Role: "bogus"},
		},
		Links: []TopoLink{{ID: "l1", From: "a", To: "b", Kind: "weird"}},
	}
	out, err := SaveTopology(good)
	if err != nil {
		t.Fatal(err)
	}
	if out.Nodes[0].Region != "HK" || out.Nodes[0].X != topoCanvasW || out.Nodes[0].Y != 0 {
		t.Fatalf("node not normalised: %+v", out.Nodes[0])
	}
	if out.Nodes[1].Role != "relay" || out.Links[0].Kind != "normal" {
		t.Fatalf("defaults not applied: %+v %+v", out.Nodes[1], out.Links[0])
	}
	if _, err := os.Stat(topologyPath()); err != nil {
		t.Fatal("topology not persisted")
	}
	topoData = nil
	if got := GetTopology(); len(got.Nodes) != 2 || len(got.Links) != 1 {
		t.Fatalf("reload mismatch: %+v", got)
	}

	bad := []Topology{
		{Nodes: []TopoNode{{ID: "a", Label: "x"}, {ID: "a", Label: "y"}}},
		{Nodes: []TopoNode{{ID: "../x", Label: "x"}}},
		{Nodes: []TopoNode{{ID: "a", Label: " "}}},
		{Nodes: []TopoNode{{ID: "a", Label: "x"}}, Links: []TopoLink{{ID: "l", From: "a", To: "missing"}}},
		{Nodes: []TopoNode{{ID: "a", Label: "x"}}, Links: []TopoLink{{ID: "l", From: "a", To: "a"}}},
	}
	for i, b := range bad {
		if _, err := SaveTopology(b); err == nil {
			t.Fatalf("case %d should fail", i)
		}
	}
}

func TestSaveAccountsKeepsTimestampWhenUnchanged(t *testing.T) {
	withTempDataDir(t)
	first, err := SaveAccounts([]AccountRecord{{ID: "r1", ServerID: 3, Provider: "RackNerd"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := SaveAccounts([]AccountRecord{{ID: "r1", ServerID: 3, Provider: "RackNerd"}})
	if err != nil {
		t.Fatal(err)
	}
	if !first[0].UpdatedAt.Equal(second[0].UpdatedAt) {
		t.Fatal("unchanged record should keep its timestamp")
	}
	if _, err := SaveAccounts([]AccountRecord{{ID: "r2"}}); err == nil {
		t.Fatal("record without server or name should fail")
	}
}
