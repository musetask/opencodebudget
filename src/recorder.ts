/** 纯函数：可单测，不依赖 opencode 上下文。 */

/** 输出 token 按 max_tokens 封顶。任一为空直接返回原始值。 */
export function capOutputTokens(
  raw: number | null | undefined,
  maxTokens: number | null | undefined,
): number | null {
  if (raw == null) return null;
  if (maxTokens == null) return raw;
  return Math.min(raw, maxTokens);
}

/** 上下文大小估算：system + messages 的 JSON 长度（字符数）。 */
export function estimateContextChars(system: unknown, messages: unknown): number {
  try {
    return (JSON.stringify(system) ?? "").length + (JSON.stringify(messages) ?? "").length;
  } catch {
    return 0;
  }
}

/** 解码速度（token/s）。total 必须大于 ttft，否则返回 null（数据不全不断言）。 */
export function calcDecodeSpeed(
  outputTokens: number | null | undefined,
  totalMs: number | null | undefined,
  ttftMs: number | null | undefined,
): number | null {
  if (outputTokens == null || totalMs == null || ttftMs == null) return null;
  const genMs = totalMs - ttftMs;
  if (genMs <= 0) return null;
  return outputTokens / (genMs / 1000);
}

/** 通用字符数：未知结构安全 stringify，失败返回 0。 */
export function safeChars(value: unknown): number {
  try {
    if (typeof value === "string") return value.length;
    return (JSON.stringify(value) ?? "").length;
  } catch {
    return 0;
  }
}
