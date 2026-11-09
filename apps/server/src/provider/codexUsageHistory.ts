// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { MAX_USAGE_PACE_SAMPLES, type ServerProviderUsageLimits } from "@t3tools/contracts";
import type { TranscriptUsageFormat } from "@t3tools/provider-core/server/usage";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  listTranscriptFiles,
  readTranscriptRecords,
  type TranscriptFile,
  type TranscriptParsePosition,
} from "../usage/usageTranscriptReader.ts";
import { codexUsageFormat, type CodexScanState } from "./Drivers/codexUsage.ts";
import { codexRateLimitsToUpdate } from "./codexUsageLimits.ts";

const HISTORY_LOOKBACK_MS = 48 * 60 * 60 * 1_000;
// Retain the first token event after every possible modern time-zone midnight.
const ACTIVITY_BUCKET_MS = 15 * 60 * 1_000;
const NativeWindow = Schema.Struct({
  used_percent: Schema.Number,
  window_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
  resets_at: Schema.optional(Schema.NullOr(Schema.Number)),
});
const TokenCountRateLimits = Schema.Struct({
  type: Schema.Literal("event_msg"),
  timestamp: Schema.String,
  payload: Schema.Struct({
    type: Schema.Literal("token_count"),
    rate_limits: Schema.Struct({
      limit_id: Schema.optional(Schema.NullOr(Schema.String)),
      plan_type: Schema.optional(Schema.NullOr(Schema.String)),
      primary: Schema.optional(Schema.NullOr(NativeWindow)),
      secondary: Schema.optional(Schema.NullOr(NativeWindow)),
    }),
  }),
});
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(TokenCountRateLimits));
const decodeProjected = Schema.decodeUnknownOption(TokenCountRateLimits);

interface NativeUsageSample {
  readonly at: string;
  readonly usedPercent: number;
  readonly hasUsage: boolean;
  readonly resetsAt: string;
  readonly windowDurationMins: number;
}

function weeklySamples(
  decoded: Option.Option<typeof TokenCountRateLimits.Type>,
  hasUsage: boolean,
): readonly NativeUsageSample[] {
  if (Option.isNone(decoded)) return [];
  const { timestamp: at, payload } = decoded.value;
  if (!Number.isFinite(Date.parse(at))) return [];
  const native = payload.rate_limits;
  const convert = (window: typeof NativeWindow.Type | null | undefined) =>
    window
      ? {
          usedPercent: window.used_percent,
          windowDurationMins: window.window_minutes ?? null,
          resetsAt: window.resets_at ?? null,
        }
      : null;
  const update = codexRateLimitsToUpdate({
    limitId: native.limit_id ?? null,
    planType: native.plan_type ?? null,
    primary: convert(native.primary),
    secondary: convert(native.secondary),
  });
  return (update?.windows ?? []).flatMap((window) =>
    window.kind === "weekly" && window.resetsAt && window.windowDurationMins
      ? [
          {
            at,
            usedPercent: window.usedPercent,
            resetsAt: window.resetsAt,
            windowDurationMins: window.windowDurationMins,
            hasUsage,
          },
        ]
      : [],
  );
}

// Codex's usage reducer supplies fork-copy suppression and whether a token event billed usage.
const observe = (
  parsed: readonly unknown[],
  state: CodexScanState,
  decoded: () => Option.Option<typeof TokenCountRateLimits.Type>,
) => (state.suppressingForkCopies ? [] : weeklySamples(decoded(), parsed.length > 0));

const codexPayloadFields = codexUsageFormat.selectFields["payload"];
const codexUsageHistoryFormat: TranscriptUsageFormat<CodexScanState, NativeUsageSample> = {
  ...codexUsageFormat,
  selectFields: {
    ...codexUsageFormat.selectFields,
    payload:
      codexPayloadFields === undefined || codexPayloadFields === true
        ? true
        : { ...codexPayloadFields, rate_limits: true },
  },
  parseLine: (line, state) => {
    const parsed = codexUsageFormat.parseLine(line, state);
    return line.includes('"rate_limits"') ? observe(parsed, state, () => decodeLine(line)) : [];
  },
  parseProjected: (projected, state) =>
    observe(codexUsageFormat.parseProjected(projected, state), state, () =>
      decodeProjected(projected),
    ),
};

function compactHistory(samples: readonly NativeUsageSample[], since: number) {
  const previous = new Map<string, NativeUsageSample>();
  const baselines = new Map<string, NativeUsageSample>();
  const activityBuckets = new Set<string>();
  const recent: NativeUsageSample[] = [];
  for (const sample of samples.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(sample.at);
    const key = `${sample.resetsAt}:${sample.windowDurationMins}`;
    if (at < since) {
      baselines.set(key, sample);
    } else {
      const bucket = `${key}:${Math.floor(at / ACTIVITY_BUCKET_MS)}`;
      if (
        previous.get(key)?.usedPercent !== sample.usedPercent ||
        (sample.hasUsage && !activityBuckets.has(bucket))
      ) {
        recent.push(sample);
      }
      if (sample.hasUsage) activityBuckets.add(bucket);
    }
    previous.set(key, sample);
  }
  return [...new Set([...baselines.values(), ...recent, ...previous.values()])].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
}

/** Reads the CLI's own rollouts, so pace survives restarts and counts sessions started outside T3. */
export function makeCodexUsageHistoryReader(homePath: string) {
  const cache = new Map<
    string,
    { file: TranscriptFile; position: TranscriptParsePosition; samples: NativeUsageSample[] }
  >();

  const read = async (limits: ServerProviderUsageLimits): Promise<ServerProviderUsageLimits> => {
    if (!limits.windows.some((window) => window.kind === "weekly")) return limits;
    const now = Date.parse(limits.checkedAt);
    const since = now - HISTORY_LOOKBACK_MS;
    const listed = await Promise.all(
      ["sessions", "archived_sessions"].map((directory) =>
        listTranscriptFiles(NodePath.join(homePath, directory), since),
      ),
    );
    const files = listed.flatMap((entry) => entry.files);
    const paths = new Set(files.map((file) => file.path));
    for (const path of cache.keys()) {
      if (!paths.has(path)) cache.delete(path);
    }
    for (const file of files) {
      const previous = cache.get(file.path);
      if (previous?.file.size === file.size && previous.file.mtimeMs === file.mtimeMs) continue;
      const parsed = await readTranscriptRecords(
        file.path,
        codexUsageHistoryFormat,
        previous && file.size > previous.file.size ? previous.position : undefined,
      );
      if (!parsed) continue;
      cache.set(file.path, {
        file,
        position: parsed.position,
        samples: compactHistory(
          [...(parsed.resumed ? (previous?.samples ?? []) : []), ...parsed.records],
          since,
        ),
      });
    }
    const samples = compactHistory(
      [...cache.values()].flatMap((entry) => entry.samples),
      since,
    );
    return {
      ...limits,
      windows: limits.windows.map((window) => {
        if (window.kind !== "weekly") return window;
        const history = samples.filter(
          (sample) =>
            sample.resetsAt === window.resetsAt &&
            sample.windowDurationMins === window.windowDurationMins &&
            Date.parse(sample.at) <= now,
        );
        // Concurrent sessions can report a rounded snapshot one point behind;
        // only a larger drop means a redeemed allowance with the same reset date.
        const resetIndex = history.findLastIndex(
          (sample, index) => index > 0 && sample.usedPercent < history[index - 1]!.usedPercent - 1,
        );
        return {
          ...window,
          usageHistorySource: "codex" as const,
          usageHistory: ((history.at(-1)?.usedPercent ?? 0) > window.usedPercent + 1 ? [] : history)
            .slice(Math.max(0, resetIndex))
            .filter((sample) => sample.usedPercent <= window.usedPercent)
            .slice(-MAX_USAGE_PACE_SAMPLES)
            .map(({ at, usedPercent, hasUsage }) => ({ at, usedPercent, hasUsage })),
        };
      }),
    };
  };

  return Effect.fn("CodexUsageHistory.read")(function* (limits: ServerProviderUsageLimits) {
    return yield* Effect.tryPromise(() => read(limits)).pipe(Effect.orElseSucceed(() => limits));
  });
}
