import { ProviderDriverKind, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProviderAdapterRequestError } from "../Errors.ts";
import type {
  NativeProviderHistoryStrategy,
  NativeProviderPersistedHistory,
} from "../nativeHarness/NativeProviderTypes.ts";
import type { OpenAiHistoryItem } from "./OpenAiProtocol.ts";

const PROVIDER = ProviderDriverKind.make("openai");
export const OPENAI_RESUME_VERSION = 1 as const;

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PersistedTurn = Schema.Struct({
  id: Schema.String,
  historyStart: NonNegativeInteger,
  historyEnd: NonNegativeInteger,
  items: Schema.Array(Schema.Unknown),
});
const PersistedHistory = Schema.Struct({
  schemaVersion: Schema.Literal(OPENAI_RESUME_VERSION),
  sessionId: Schema.String,
  history: Schema.Array(JsonObject),
  turns: Schema.Array(PersistedTurn),
  totalProcessedTokens: NonNegativeInteger,
});
const decodePersistedHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(PersistedHistory));

export const encodeOpenAiJsonUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function resumeError(method: string, detail: string, cause?: unknown) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function encodeOpenAiPersistedHistory(
  input: NativeProviderPersistedHistory<OpenAiHistoryItem> & { readonly sessionId: string },
): string {
  return encodeOpenAiJsonUnknown({ schemaVersion: OPENAI_RESUME_VERSION, ...input });
}

export const decodeOpenAiPersistedHistory = Effect.fn("decodeOpenAiPersistedHistory")(function* (
  encoded: string,
  sessionId: string,
) {
  const persisted = yield* decodePersistedHistory(encoded, { onExcessProperty: "error" }).pipe(
    Effect.mapError((cause) =>
      resumeError(
        "session/resume",
        `OpenAI session '${sessionId}' contains invalid persisted history.`,
        cause,
      ),
    ),
  );
  if (persisted.sessionId !== sessionId) {
    return yield* resumeError(
      "session/resume",
      `OpenAI session '${sessionId}' does not match its persisted history identifier.`,
    );
  }
  if (
    persisted.turns.some(
      (turn) => turn.historyEnd < turn.historyStart || turn.historyEnd > persisted.history.length,
    )
  ) {
    return yield* resumeError(
      "session/resume",
      `OpenAI session '${sessionId}' contains invalid persisted turn boundaries.`,
    );
  }
  return {
    history: [...persisted.history] as Array<OpenAiHistoryItem>,
    turns: persisted.turns.map((turn) => ({
      ...turn,
      id: TurnId.make(turn.id),
      items: [...turn.items],
    })),
    totalProcessedTokens: persisted.totalProcessedTokens,
  } satisfies NativeProviderPersistedHistory<OpenAiHistoryItem>;
});

export const openAiHistoryStrategy: NativeProviderHistoryStrategy<OpenAiHistoryItem> = {
  directoryName: "openai",
  resumeVersion: OPENAI_RESUME_VERSION,
  encode: encodeOpenAiPersistedHistory,
  decode: decodeOpenAiPersistedHistory,
  estimateBytes: (items) => Buffer.byteLength(encodeOpenAiJsonUnknown(items)),
};
