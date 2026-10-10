import { createHash } from "node:crypto";
import * as os from "node:os";

/** 机器指纹：同一台机器长期稳定，多机合并时靠它区分。取 sha256 前 12 位 hex。 */
export function getMachineFingerprint(): string {
  const raw = [os.hostname(), os.platform(), os.arch(), os.userInfo().username].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}
