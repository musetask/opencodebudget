import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface StepRow {
  id?: number;
  ts: number;
  session_id: string;
  agent: string;
  provider: string;
  model: string;
  kind: string;
  ttft_ms: number | null;
  total_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read: number | null;
  cache_write: number | null;
  context_chars: number | null;
  max_tokens: number | null;
  machine: string;
  project: string | null;
  status: string | null;
}

export interface ToolRow {
  ts: number;
  session_id: string;
  agent: string;
  tool: string;
  call_id: string | null;
  duration_ms: number | null;
  status: string | null;
  input_chars: number | null;
  output_chars: number | null;
  machine: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  ttft_ms INTEGER,
  total_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  context_chars INTEGER,
  max_tokens INTEGER,
  machine TEXT NOT NULL,
  project TEXT,
  status TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_session ON steps(session_id, ts);
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  call_id TEXT,
  duration_ms INTEGER,
  status TEXT,
  input_chars INTEGER,
  output_chars INTEGER,
  machine TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_calls(session_id, ts);
`;

/** 全局库路径：env > option > XDG_DATA_HOME > ~/.local/share。 */
export function resolveDbPath(optionPath?: string): string {
  if (process.env.OPENCODE_BUDGET_DB) return process.env.OPENCODE_BUDGET_DB;
  if (optionPath) return optionPath;
  const base =
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "opencode-budget", "budget.db");
}

export type BudgetDb = {
  insertStep(row: StepRow): number;
  updateStepCompletion(
    id: number,
    patch: Pick<
      StepRow,
      | "total_ms"
      | "input_tokens"
      | "output_tokens"
      | "reasoning_tokens"
      | "cache_read"
      | "cache_write"
      | "status"
    >,
  ): void;
  insertTool(row: ToolRow): void;
  close(): void;
};

export function openDb(dbPath: string): BudgetDb {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // 老库迁移：已存在的 steps 表补 reasoning_tokens 列（已存在则忽略）。
  try {
    db.exec("ALTER TABLE steps ADD COLUMN reasoning_tokens INTEGER;");
  } catch {
    // 列已存在，忽略
  }

  const insertStepStmt = db.prepare(`
    INSERT INTO steps (ts, session_id, agent, provider, model, kind, ttft_ms, total_ms,
      input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, context_chars, max_tokens,
      machine, project, status)
    VALUES (@ts, @session_id, @agent, @provider, @model, @kind, @ttft_ms, @total_ms,
      @input_tokens, @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @context_chars, @max_tokens,
      @machine, @project, @status)
  `);
  const updateStepStmt = db.prepare(`
    UPDATE steps SET total_ms = @total_ms, input_tokens = @input_tokens,
      output_tokens = @output_tokens, reasoning_tokens = @reasoning_tokens,
      cache_read = @cache_read,
      cache_write = @cache_write, status = @status WHERE id = @id
  `);
  const insertToolStmt = db.prepare(`
    INSERT INTO tool_calls (ts, session_id, agent, tool, call_id, duration_ms, status,
      input_chars, output_chars, machine)
    VALUES (@ts, @session_id, @agent, @tool, @call_id, @duration_ms, @status,
      @input_chars, @output_chars, @machine)
  `);

  return {
    insertStep(row: StepRow): number {
      const params: Record<string, SQLInputValue> = {
        ts: row.ts,
        session_id: row.session_id,
        agent: row.agent,
        provider: row.provider,
        model: row.model,
        kind: row.kind,
        ttft_ms: row.ttft_ms,
        total_ms: row.total_ms,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        reasoning_tokens: row.reasoning_tokens,
        cache_read: row.cache_read,
        cache_write: row.cache_write,
        context_chars: row.context_chars,
        max_tokens: row.max_tokens,
        machine: row.machine,
        project: row.project,
        status: row.status,
      };
      const r = insertStepStmt.run(params);
      return Number(r.lastInsertRowid);
    },
    updateStepCompletion(id, patch): void {
      updateStepStmt.run({
        total_ms: patch.total_ms,
        input_tokens: patch.input_tokens,
        output_tokens: patch.output_tokens,
        reasoning_tokens: patch.reasoning_tokens,
        cache_read: patch.cache_read,
        cache_write: patch.cache_write,
        status: patch.status,
        id,
      });
    },
    insertTool(row: ToolRow): void {
      insertToolStmt.run({
        ts: row.ts,
        session_id: row.session_id,
        agent: row.agent,
        tool: row.tool,
        call_id: row.call_id,
        duration_ms: row.duration_ms,
        status: row.status,
        input_chars: row.input_chars,
        output_chars: row.output_chars,
        machine: row.machine,
      });
    },
    close(): void {
      db.close();
    },
  };
}
