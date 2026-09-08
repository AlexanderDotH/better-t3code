import type {
  ProviderHistoryAttachment,
  ProviderHistoryMessage,
  ProviderHistoryPlan,
  ProviderHistoryTranscriptItem,
} from "../Services/ProviderHistorySync.ts";

export interface ProviderHistoryMessageCandidate {
  readonly kind: "message";
  readonly nativeMessageId: string;
  readonly role: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<ProviderHistoryAttachment>;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface ProviderHistoryPlanCandidate {
  readonly kind: "plan";
  readonly nativePlanId: string;
  readonly markdown: string;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export type ProviderHistoryTranscriptCandidate =
  | ProviderHistoryMessageCandidate
  | ProviderHistoryPlanCandidate;

function visibleMessage(
  candidate: ProviderHistoryMessageCandidate,
): ProviderHistoryMessage | undefined {
  if (candidate.role !== "user" && candidate.role !== "assistant") return undefined;
  if (candidate.nativeMessageId.trim().length === 0) return undefined;
  if (candidate.text.trim().length === 0 && candidate.attachments.length === 0) return undefined;
  return { ...candidate, role: candidate.role };
}

function visiblePlan(candidate: ProviderHistoryPlanCandidate): ProviderHistoryPlan | undefined {
  if (candidate.nativePlanId.trim().length === 0 || candidate.markdown.trim().length === 0) {
    return undefined;
  }
  return candidate;
}

/**
 * Keeps only transcript content a user can see and de-duplicates provider
 * replay without losing a plan that happens to reuse a message identifier.
 */
export function normalizeVisibleProviderHistoryTranscript(
  candidates: ReadonlyArray<ProviderHistoryTranscriptCandidate>,
): ReadonlyArray<ProviderHistoryTranscriptItem> {
  const seen = new Set<string>();
  const items: ProviderHistoryTranscriptItem[] = [];

  for (const candidate of candidates) {
    const item = candidate.kind === "message" ? visibleMessage(candidate) : visiblePlan(candidate);
    if (item === undefined) continue;
    const nativeId = item.kind === "message" ? item.nativeMessageId : item.nativePlanId;
    const identity = `${item.kind}:${nativeId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    items.push(item);
  }

  return items;
}

export function makeFallbackNativeItemId(
  sessionId: string,
  kind: ProviderHistoryTranscriptItem["kind"],
  stableOrdinal: number,
): string {
  return `${sessionId}:${kind}:${stableOrdinal}`;
}
