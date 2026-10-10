// Package main 实现 budget 查询层 V1：one-shot 只读 CLI。
//
// 只读保证：sqlite 以 mode=ro 打开，程序内只有 SELECT。
// 输出保持紧凑：一组一行，只给 p50/p90 档位，不倒原始数据。
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

// resolveDBPath 与 TS 记录层一致：env > flag > XDG > ~/.local/share。
func resolveDBPath(flagPath string) string {
	if v := os.Getenv("OPENCODE_BUDGET_DB"); v != "" {
		return v
	}
	if flagPath != "" {
		return flagPath
	}
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "opencode-budget", "budget.db")
}

func openReadOnly(dbPath string) (*sql.DB, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("db path 为空")
	}
	// mode=ro：只读打开，绝不建库、不写 WAL。
	dsn := "file:" + dbPath + "?mode=ro"
	return sql.Open("sqlite", dsn)
}

func usage() {
	fmt.Fprintf(os.Stderr, `budget - opencodebudget 主动查询层（只读 one-shot CLI）

用法：
  budget steps [--task build] [--provider ladder] [--model xxx] [--kind primary] [--ctx-bucket s|m|l] [--db PATH]
  budget tools [--tool read] [--db PATH]
  budget stats [--db PATH]

ctx-bucket 按 context_chars 分档：s<30k, m=30k~120k, l>120k。
输出一行一组，只给样本数与 p50/p90。
`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "steps":
		runSteps(os.Args[2:])
	case "tools":
		runTools(os.Args[2:])
	case "stats":
		runStats(os.Args[2:])
	case "-h", "--help", "help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "未知子命令：%s\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func runSteps(args []string) {
	fs := flag.NewFlagSet("steps", flag.ExitOnError)
	task := fs.String("task", "", "任务类型（agent，如 build/plan），空=不限")
	provider := fs.String("provider", "", "渠道 ID，空=不限")
	model := fs.String("model", "", "模型 ID，空=不限")
	kind := fs.String("kind", "primary", "请求种类，空=不限")
	bucket := fs.String("ctx-bucket", "", "上下文分档 s|m|l，空=不限")
	dbPath := fs.String("db", "", "库路径，默认走全局账本")
	_ = fs.Parse(args)

	db, err := openReadOnly(resolveDBPath(*dbPath))
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	query, qargs := buildStepsQuery(*task, *provider, *model, *kind, *bucket)
	rows, err := db.Query(query, qargs...)
	if err != nil {
		fatal(err)
	}
	defer rows.Close()

	type agg struct {
		n     int
		total []float64
		ttft  []float64
		label string
	}
	groups := map[string]*agg{}
	order := []string{}
	for rows.Next() {
		var g, k string
		var total, ttft sql.NullFloat64
		if err := rows.Scan(&g, &k, &total, &ttft); err != nil {
			fatal(err)
		}
		label := "task=" + g + " kind=" + k
		a := groups[label]
		if a == nil {
			a = &agg{label: label}
			groups[label] = a
			order = append(order, label)
		}
		a.n++
		if total.Valid {
			a.total = append(a.total, total.Float64)
		}
		if ttft.Valid {
			a.ttft = append(a.ttft, ttft.Float64)
		}
	}
	if err := rows.Err(); err != nil {
		fatal(err)
	}
	if len(order) == 0 {
		fmt.Println("steps n=0（无匹配样本）")
		return
	}
	for _, label := range order {
		a := groups[label]
		fmt.Printf("steps %s n=%d total_ms p50=%s p90=%s ttft_ms p50=%s p90=%s\n",
			label, a.n,
			ms(Percentile(a.total, 0.5)), ms(Percentile(a.total, 0.9)),
			ms(Percentile(a.ttft, 0.5)), ms(Percentile(a.ttft, 0.9)))
	}
}

func runTools(args []string) {
	fs := flag.NewFlagSet("tools", flag.ExitOnError)
	tool := fs.String("tool", "", "工具名，空=不限")
	dbPath := fs.String("db", "", "库路径，默认走全局账本")
	_ = fs.Parse(args)

	db, err := openReadOnly(resolveDBPath(*dbPath))
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	query := `SELECT tool, duration_ms FROM tool_calls WHERE status = 'completed'`
	var qargs []any
	if *tool != "" {
		query += ` AND tool = ?`
		qargs = append(qargs, *tool)
	}
	rows, err := db.Query(query, qargs...)
	if err != nil {
		fatal(err)
	}
	defer rows.Close()

	groups := map[string][]float64{}
	order := []string{}
	total := 0
	for rows.Next() {
		var name string
		var d sql.NullFloat64
		if err := rows.Scan(&name, &d); err != nil {
			fatal(err)
		}
		if _, ok := groups[name]; !ok {
			order = append(order, name)
		}
		total++
		if d.Valid {
			groups[name] = append(groups[name], d.Float64)
		}
	}
	if err := rows.Err(); err != nil {
		fatal(err)
	}
	if total == 0 {
		fmt.Println("tools n=0（无匹配样本）")
		return
	}
	for _, name := range order {
		ds := groups[name]
		fmt.Printf("tools tool=%s n=%d duration_ms p50=%s p90=%s\n",
			name, len(ds), ms(Percentile(ds, 0.5)), ms(Percentile(ds, 0.9)))
	}
}

func runStats(args []string) {
	fs := flag.NewFlagSet("stats", flag.ExitOnError)
	dbPath := fs.String("db", "", "库路径，默认走全局账本")
	_ = fs.Parse(args)

	db, err := openReadOnly(resolveDBPath(*dbPath))
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	var steps, done, tools int
	if err := db.QueryRow(`SELECT COUNT(*) FROM steps`).Scan(&steps); err != nil {
		fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM steps WHERE status = 'completed'`).Scan(&done); err != nil {
		fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM tool_calls`).Scan(&tools); err != nil {
		fatal(err)
	}
	fmt.Printf("stats steps=%d completed=%d tool_calls=%d db=%s\n", steps, done, tools, resolveDBPath(*dbPath))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "budget:", err)
	os.Exit(1)
}
