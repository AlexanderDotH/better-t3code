import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProviderItemId, type ProviderRuntimeEvent, ThreadId } from "@t3tools/contracts";

export interface ClaudeResumeState {
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

export function hasDurableClaudeSessionId(message: SDKMessage): boolean {
  if (message.type !== "system") return true;
  return (
    message.subtype !== "hook_started" &&
    message.subtype !== "hook_progress" &&
    message.subtype !== "hook_response"
  );
}

export function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") return undefined;
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
  };
  const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : undefined;
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.make(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt =
    typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : undefined;
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;
  return {
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnCountValue !== undefined && Number.isInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
  };
}

export function nativeProviderRefs(options?: {
  readonly providerItemId?: string | undefined;
}): NonNullable<ProviderRuntimeEvent["providerRefs"]> {
  return options?.providerItemId
    ? { providerItemId: ProviderItemId.make(options.providerItemId) }
    : {};
}
