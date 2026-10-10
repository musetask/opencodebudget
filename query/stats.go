package main

import (
	"fmt"
	"sort"

	_ "modernc.org/sqlite"
)

// Percentile 用 nearest-rank 法。空样本返回 -1，调用方打印为 "-"。
func Percentile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return -1
	}
	cp := append([]float64(nil), sorted...)
	sort.Float64s(cp)
	if q <= 0 {
		return cp[0]
	}
	if q >= 1 {
		return cp[len(cp)-1]
	}
	// nearest-rank: ceil(q*n) 第几个（1-based）
	rank := int(q*float64(len(cp)) + 0.999999999)
	if rank < 1 {
		rank = 1
	}
	if rank > len(cp) {
		rank = len(cp)
	}
	return cp[rank-1]
}

// ms 把毫秒数打印成整数，-1（无样本）打印 "-"。
func ms(v float64) string {
	if v < 0 {
		return "-"
	}
	return fmt.Sprintf("%.0f", v)
}

// ctxBucketCond 把 s|m|l 翻成 context_chars 上的 SQL 条件。
func ctxBucketCond(bucket string) (string, bool) {
	switch bucket {
	case "s":
		return `context_chars < 30000`, true
	case "m":
		return `context_chars >= 30000 AND context_chars <= 120000`, true
	case "l":
		return `context_chars > 120000`, true
	default:
		return "", false
	}
}

// buildStepsQuery 组装 steps 查询。只看 completed 行（token/总量回填完整的）。
func buildStepsQuery(task, provider, model, kind, bucket string) (string, []any) {
	query := `SELECT agent, kind, total_ms, ttft_ms FROM steps WHERE status = 'completed'`
	var args []any
	if task != "" {
		query += ` AND agent = ?`
		args = append(args, task)
	}
	if provider != "" {
		query += ` AND provider = ?`
		args = append(args, provider)
	}
	if model != "" {
		query += ` AND model = ?`
		args = append(args, model)
	}
	if kind != "" {
		query += ` AND kind = ?`
		args = append(args, kind)
	}
	if cond, ok := ctxBucketCond(bucket); ok {
		query += ` AND ` + cond
	}
	return query, args
}
