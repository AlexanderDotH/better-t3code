// @effect-diagnostics nodeBuiltinImport:off - Deterministic import identifiers use SHA-256.
import * as NodeCrypto from "node:crypto";

import { toSafeThreadAttachmentSegment } from "../attachmentStore.ts";

export function makeHarnessChatSyncId(
  kind: string,
  ...identityParts: ReadonlyArray<string>
): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(identityParts.join("\0"))
    .digest("hex")
    .slice(0, 32);
  return `harness-sync-${kind}-${digest}`;
}

export function makeHarnessChatSyncAttachmentId(input: {
  readonly threadId: string;
  readonly sourceId: string;
  readonly nativeMessageId: string;
  readonly nativeAttachmentId: string;
}): string {
  const threadSegment = toSafeThreadAttachmentSegment(input.threadId) ?? "harness-sync";
  const digest = NodeCrypto.createHash("sha256")
    .update([input.sourceId, input.nativeMessageId, input.nativeAttachmentId].join("\0"))
    .digest("hex")
    .slice(0, 32);
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20),
  ].join("-");
  return `${threadSegment}-${uuid}`;
}
