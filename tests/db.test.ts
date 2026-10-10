import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.ts";

describe("db", () => {
  it("建表 + 插入 step/tool + 回填完成", () => {
    const db = openDb(":memory:");
    const id = db.insertStep({
      ts: Date.now(),
      session_id: "ses_test",
      agent: "build",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      kind: "primary",
      ttft_ms: 1200,
      total_ms: null,
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cache_read: null,
      cache_write: null,
      context_chars: 1024,
      max_tokens: 8000,
      machine: "abc123def456",
      project: "/tmp/proj",
      status: "streaming",
    });
    assert.ok(id > 0);
    db.updateStepCompletion(id, {
      total_ms: 5000,
      input_tokens: 100,
      output_tokens: 200,
      reasoning_tokens: 50,
      cache_read: 10,
      cache_write: 5,
      status: "completed",
    });
    db.insertTool({
      ts: Date.now(),
      session_id: "ses_test",
      agent: "build",
      tool: "read",
      call_id: "call_1",
      duration_ms: 30,
      status: "completed",
      input_chars: 50,
      output_chars: 100,
      machine: "abc123def456",
    });
    db.close();
  });

  it("内存库可用（node:sqlite 烟囱测试）", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("CREATE TABLE t(a INT); INSERT INTO t VALUES (1)");
    const rows = raw.prepare("SELECT * FROM t").all();
    assert.equal((rows[0] as { a: number }).a, 1);
    raw.close();
  });
});
