import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capOutputTokens,
  estimateContextChars,
  calcDecodeSpeed,
  safeChars,
} from "../src/recorder.ts";
import { getMachineFingerprint } from "../src/fingerprint.ts";
import { resolveDbPath } from "../src/db.ts";

describe("capOutputTokens", () => {
  it("按 max_tokens 封顶", () => {
    assert.equal(capOutputTokens(9000, 8000), 8000);
    assert.equal(capOutputTokens(500, 8000), 500);
  });
  it("任一为空返回原始值", () => {
    assert.equal(capOutputTokens(null, 8000), null);
    assert.equal(capOutputTokens(500, null), 500);
    assert.equal(capOutputTokens(500, undefined), 500);
  });
});

describe("estimateContextChars", () => {
  it("system + messages 长度相加", () => {
    const n = estimateContextChars([{ type: "text" }], [{ role: "user" }]);
    assert.ok(n > 0);
  });
  it("异常结构返回 0 不抛", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(estimateContextChars(circular, circular), 0);
  });
});

describe("calcDecodeSpeed", () => {
  it("output / (total - ttft)", () => {
    const v = calcDecodeSpeed(100, 5000, 1000);
    assert.equal(v, 25);
  });
  it("数据不全返回 null", () => {
    assert.equal(calcDecodeSpeed(null, 5000, 1000), null);
    assert.equal(calcDecodeSpeed(100, 1000, 1000), null);
    assert.equal(calcDecodeSpeed(100, 500, 1000), null);
  });
});

describe("safeChars", () => {
  it("字符串直接量长度", () => {
    assert.equal(safeChars("hello"), 5);
  });
  it("对象 stringify", () => {
    assert.ok(safeChars({ a: 1 }) > 0);
  });
});

describe("getMachineFingerprint", () => {
  it("稳定且 12 位 hex", () => {
    const a = getMachineFingerprint();
    const b = getMachineFingerprint();
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{12}$/);
  });
});

describe("resolveDbPath", () => {
  it("环境变量优先", () => {
    const prev = process.env.OPENCODE_BUDGET_DB;
    process.env.OPENCODE_BUDGET_DB = "/tmp/custom.db";
    assert.equal(resolveDbPath("/opt/other.db"), "/tmp/custom.db");
    if (prev === undefined) delete process.env.OPENCODE_BUDGET_DB;
    else process.env.OPENCODE_BUDGET_DB = prev;
  });
  it("默认走全局目录", () => {
    const prev = process.env.OPENCODE_BUDGET_DB;
    delete process.env.OPENCODE_BUDGET_DB;
    const p = resolveDbPath();
    assert.ok(p.endsWith("opencode-budget/budget.db"));
    if (prev !== undefined) process.env.OPENCODE_BUDGET_DB = prev;
  });
});
