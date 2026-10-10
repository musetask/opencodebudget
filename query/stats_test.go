package main

import (
	"strings"
	"testing"
)

func TestPercentile(t *testing.T) {
	xs := []float64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	if got := Percentile(xs, 0.5); got != 50 {
		t.Fatalf("p50 = %v, want 50", got)
	}
	if got := Percentile(xs, 0.9); got != 90 {
		t.Fatalf("p90 = %v, want 90", got)
	}
	// 输入乱序也不影响结果（内部拷贝排序）
	rev := []float64{100, 90, 80, 70, 60, 50, 40, 30, 20, 10}
	if got := Percentile(rev, 0.5); got != 50 {
		t.Fatalf("乱序 p50 = %v, want 50", got)
	}
	if got := Percentile(nil, 0.5); got != -1 {
		t.Fatalf("空样本 = %v, want -1", got)
	}
	if got := Percentile([]float64{7}, 0.9); got != 7 {
		t.Fatalf("单样本 = %v, want 7", got)
	}
}

func TestMs(t *testing.T) {
	if ms(-1) != "-" {
		t.Fatal(`无样本应打印 "-"`)
	}
	if ms(5942.4) != "5942" {
		t.Fatalf("ms(5942.4) = %q", ms(5942.4))
	}
}

func TestBuildStepsQuery(t *testing.T) {
	q, args := buildStepsQuery("build", "ladder", "", "primary", "m")
	if !strings.Contains(q, "status = 'completed'") {
		t.Fatalf("必须只看 completed 行：%s", q)
	}
	if !strings.Contains(q, "agent = ?") || !strings.Contains(q, "provider = ?") {
		t.Fatalf("过滤条件缺失：%s", q)
	}
	if strings.Contains(q, "model = ?") {
		t.Fatalf("空 model 不应进条件：%s", q)
	}
	if !strings.Contains(q, "context_chars >=") {
		t.Fatalf("m 档条件缺失：%s", q)
	}
	if len(args) != 3 {
		t.Fatalf("args = %v, want 3", args)
	}

	q2, args2 := buildStepsQuery("", "", "", "", "xx")
	if strings.Contains(q2, "AND") {
		t.Fatalf("全空不应有过滤：%s", q2)
	}
	if len(args2) != 0 {
		t.Fatalf("args2 = %v, want 0", args2)
	}
}

func TestCtxBucketCond(t *testing.T) {
	for _, b := range []string{"s", "m", "l"} {
		if _, ok := ctxBucketCond(b); !ok {
			t.Fatalf("bucket %q 应合法", b)
		}
	}
	if _, ok := ctxBucketCond("xx"); ok {
		t.Fatal("非法 bucket 应返回 false")
	}
}
