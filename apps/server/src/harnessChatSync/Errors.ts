import {
  HarnessChatSyncFailure,
  HarnessChatSyncError,
  type HarnessChatSessionId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const isHarnessChatSyncError = Schema.is(HarnessChatSyncError);

export class SessionSyncFailure extends Schema.TaggedErrorClass<SessionSyncFailure>()(
  "SessionSyncFailure",
  {
    failure: HarnessChatSyncFailure,
    messagesImported: Schema.Number,
    attachmentsImported: Schema.Number,
    attachmentsSkipped: Schema.Number,
  },
) {}

export function harnessSyncError(
  code: HarnessChatSyncError["code"],
  message: string,
  cause?: unknown,
): HarnessChatSyncError {
  return new HarnessChatSyncError({
    code,
    message: message.trim() || "Harness chat sync failed.",
    ...(cause === undefined ? {} : { cause }),
  });
}

export function describeFailure(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  const rendered = String(cause).trim();
  return rendered && rendered !== "[object Object]" ? rendered : fallback;
}

export function sessionSyncFailure(input: {
  readonly sessionId: HarnessChatSessionId;
  readonly code: HarnessChatSyncFailure["code"];
  readonly message: string;
  readonly retryable: boolean;
  readonly messagesImported?: number;
  readonly attachmentsImported?: number;
  readonly attachmentsSkipped?: number;
}): SessionSyncFailure {
  return new SessionSyncFailure({
    failure: {
      sessionId: input.sessionId,
      code: input.code,
      message: input.message.trim() || "This chat could not be synchronized.",
      retryable: input.retryable,
    },
    messagesImported: input.messagesImported ?? 0,
    attachmentsImported: input.attachmentsImported ?? 0,
    attachmentsSkipped: input.attachmentsSkipped ?? 0,
  });
}
