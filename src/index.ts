import { Plugin } from "@opencode/plugin";
import { openDb, resolveDbPath, type BudgetDb } from "./db.ts";
import { getMachineFingerprint } from "./fingerprint.ts";
import {
  capOutputTokens,
  estimateContextChars,
  safeChars,
} from "./recorder.ts";

interface PendingRequest {
  t0: number;
  httpStart: number | null;
  agent: string;
  provider: string;
  model: string;
  kind: string;
  contextChars: number | null;
  maxTokens: number | null;
}

interface PendingTool {
  t0: number;
  inputChars: number;
}

/** 事件提取：只认实测过的 v2 事件形状，其他一律跳过（返回 done=false），绝不抛。 */
function pickTokens(event: unknown): {
  sessionID: string | null;
  created: number | null;
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  done: boolean;
} {
  const out = {
    sessionID: null as string | null,
    created: null as number | null,
    input: null as number | null,
    output: null as number | null,
    reasoning: null as number | null,
    cacheRead: null as number | null,
    cacheWrite: null as number | null,
    done: false,
  };
  try {
    const e = event as Record<string, any>;
    if (typeof e.created === "number") out.created = e.created;
    if (e.type !== "session.usage.updated") return out;
    const data = e.data as Record<string, any> | undefined;
    if (!data || typeof data.sessionID !== "string") return out;
    out.sessionID = data.sessionID;
    const tokens = data.tokens as Record<string, any> | undefined;
    if (tokens) {
      const num = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      out.input = num(tokens.input);
      out.output = num(tokens.output);
      out.reasoning = num(tokens.reasoning);
      out.cacheRead = num(tokens.cache?.read);
      out.cacheWrite = num(tokens.cache?.write);
    }
    out.done = true;
  } catch {
    // 忽略：记录层绝不因为解析失败影响主流程
  }
  return out;
}

export default Plugin.define({
  id: "opencode-budget-recorder",
  async setup(ctx) {
    let db: BudgetDb | null = null;
    try {
      const dbPath = resolveDbPath(
        (ctx.options as Record<string, unknown>)?.dbPath as
          | string
          | undefined,
      );
      db = openDb(dbPath);
    } catch (err) {
      console.error("[budget-recorder] open db failed, disabled:", err);
      return;
    }

    const machine = getMachineFingerprint();
    const project: string | null =
      ctx.location.project.canonical ?? ctx.location.directory ?? null;

    const pending = new Map<string, PendingRequest>();
    // 同一 session 可能有多个在途 step（title + primary），按 FIFO 配对 usage 事件。
    const stepQueue = new Map<
      string,
      Array<{ rowId: number; t0: number; maxTokens: number | null }>
    >();
    const pendingTools = new Map<string, PendingTool>();
    const key = (sessionID: string) => sessionID;

    const safe = (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        console.error("[budget-recorder]", err);
      }
    };

    // --- 步骤：context 记录模型/上下文/maxTokens；http.request/response 打时间点 ---
    const recordContext = (kind: string) => (event: any) => {
      safe(() => {
        const prev = pending.get(key(event.sessionID));
        pending.set(key(event.sessionID), {
          // 每次 context hook 都是一次新请求：t0 重置为本次，total 才是一步的耗时。
          t0: Date.now(),
          httpStart: null,
          agent: event.agent ?? prev?.agent ?? "unknown",
          provider: event.model?.providerID ?? prev?.provider ?? "unknown",
          model: event.model?.id ?? event.model?.model ?? prev?.model ?? "unknown",
          kind,
          contextChars: estimateContextChars(event.system, event.messages),
          maxTokens:
            typeof event.options?.maxTokens === "number"
              ? event.options.maxTokens
              : (prev?.maxTokens ?? null),
        });
      });
    };

    await ctx.session.hook("context", recordContext("primary"));
    await ctx.session.hook("compaction", recordContext("compaction"));
    await ctx.session.hook("generate", recordContext("generate"));
    await ctx.session.hook("title", recordContext("title"));

    await ctx.session.hook("http.request", (event: any) => {
      safe(() => {
        const p = pending.get(key(event.sessionID)) ?? {
          t0: Date.now(),
          httpStart: null,
          agent: event.agent ?? "unknown",
          provider: event.model?.providerID ?? "unknown",
          model: event.model?.id ?? "unknown",
          kind: event.kind ?? "primary",
          contextChars: null,
          maxTokens: null,
        };
        p.httpStart = Date.now();
        p.agent = event.agent ?? p.agent;
        pending.set(key(event.sessionID), p);
      });
    });

    await ctx.session.hook("http.response", (event: any) => {
      safe(() => {
        if (!db) return;
        const p = pending.get(key(event.sessionID));
        if (!p) return;
        const now = Date.now();
        const ttft = p.httpStart != null ? now - p.httpStart : null;
        const id = db.insertStep({
          ts: p.t0,
          session_id: event.sessionID,
          agent: p.agent,
          provider: p.provider,
          model: p.model,
          kind: event.kind ?? p.kind,
          ttft_ms: ttft,
          total_ms: null,
          input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
          cache_read: null,
          cache_write: null,
          context_chars: p.contextChars,
          max_tokens: p.maxTokens,
          machine,
          project,
          status: "streaming",
        });
        const q = stepQueue.get(key(event.sessionID)) ?? [];
        q.push({ rowId: id, t0: p.t0, maxTokens: p.maxTokens });
        stepQueue.set(key(event.sessionID), q);
      });
    });

    // --- 工具：before/after 配对算耗时 ---
    await ctx.tool.hook("execute.before", (event: any) => {
      safe(() => {
        pendingTools.set(`${event.sessionID}:${event.id}`, {
          t0: Date.now(),
          inputChars: safeChars(event.input),
        });
      });
    });

    await ctx.tool.hook("execute.after", (event: any) => {
      safe(() => {
        if (!db) return;
        const k = `${event.sessionID}:${event.id}`;
        const start = pendingTools.get(k);
        pendingTools.delete(k);
        const duration = start ? Date.now() - start.t0 : null;
        db.insertTool({
          ts: start?.t0 ?? Date.now(),
          session_id: event.sessionID,
          agent: event.agent ?? "unknown",
          tool: event.tool,
          call_id: String(event.id ?? ""),
          duration_ms: duration,
          status: event.status,
          input_chars: start?.inputChars ?? safeChars(event.input),
          output_chars: safeChars(
            (event as { result?: unknown }).result ??
              (event as { error?: unknown }).error,
          ),
          machine,
        });
      });
    });

    // --- 事件流：补 token + 总耗时（抠不到就跳过，不阻塞） ---
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          safe(() => {
            if (!db) return;
            const t = pickTokens(event);
            if (!t.sessionID || !t.done) return;
            const q = stepQueue.get(key(t.sessionID));
            const head = q?.shift();
            if (!head) return;
            if (q && q.length === 0) stepQueue.delete(key(t.sessionID));
            // usage 事件按请求顺序到达，FIFO 头即为本次完成的 step。
            const capped =
              t.output != null
                ? capOutputTokens(t.output, head.maxTokens)
                : null;
            db.updateStepCompletion(head.rowId, {
              total_ms:
                t.created != null ? t.created - head.t0 : Date.now() - head.t0,
              input_tokens: t.input,
              output_tokens: capped,
              reasoning_tokens: t.reasoning,
              cache_read: t.cacheRead,
              cache_write: t.cacheWrite,
              status: "completed",
            });
          });
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          console.error("[budget-recorder] event loop ended:", err);
        }
      }
    })();

    return () => {
      controller.abort();
      try {
        db?.close();
      } catch {
        // 忽略关闭错误
      }
      db = null;
    };
  },
});
