import {
  type ClaudeUsageContext,
  type CodexUsageContext,
  initialClaudeUsageContext,
  initialCodexUsageContext,
  observeClaudeUsageContext,
  takeClaudeUsageContext,
  observeCodexSessionContext,
  observeCodexResponseContext,
  takeCodexUsageContext,
} from "./usageContextAttribution.ts";
/**
 * Pure parsers for the provider CLIs' on-disk session transcripts.
 *
 * Each parser is a line-at-a-time reducer so callers can stream large files
 * without materialising them. None of them touch the filesystem.
 *
 * @module usageTranscripts
 */
import type {
  UsageCallKind,
  UsageContextDiagnostics,
  UsageProviderKind,
  UsageTokenTotals,
} from "@t3tools/contracts";

export interface UsageRecord {
  readonly provider: UsageProviderKind;
  readonly timestampMs: number;
  readonly model: string;
  /**
   * Rate-table key when the provider's display name carries tiers the table
   * does not know, such as Cursor's `claude-opus-5-5-high`. Defaults to `model`.
   */
  readonly rateModel?: string;
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly callKind: UsageCallKind;
  readonly diagnostics?: UsageContextDiagnostics;
  readonly reportedCostUsd: number | null;
  /**
   * Whether the request ran in fast mode, which bills at a model-specific
   * multiple of the standard rate. Only Claude Code records this.
   */
  readonly fast: boolean;
  /**
   * Key for cross-file de-duplication, or `null` when the record is inherently
   * unique and needs no dedup.
   */
  readonly dedupeKey: string | null;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function totalTokens(totals: UsageTokenTotals): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

/**
 * Grok reports cost in integer ticks where `1 USD = 10^10` ticks. See Grok
 * headless `total_cost_usd_ticks`. Convert to dollars for pricing.
 */
export const GROK_COST_USD_TICKS_PER_DOLLAR = 10_000_000_000;

function grokCostTicksToUsd(ticks: unknown): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / GROK_COST_USD_TICKS_PER_DOLLAR;
}

export interface ClaudeScanState extends ClaudeUsageContext {}

export function initialClaudeScanState(): ClaudeScanState {
  return initialClaudeUsageContext();
}

/** Claude repeats usage for each content block; callers keep the first record per dedupeKey. */
export function parseClaudeLine(
  line: string,
  state: ClaudeScanState = initialClaudeScanState(),
): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return parseClaudeRecord(parsed, state);
}

function parseClaudeRecord(
  parsed: unknown,
  state: ClaudeScanState = initialClaudeScanState(),
): UsageRecord | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["type"] === "user") {
    observeClaudeUsageContext(record, state);
    return null;
  }
  if (record["type"] !== "assistant") return null;

  const message = record["message"];
  if (typeof message !== "object" || message === null) return null;
  const messageRecord = message as Record<string, unknown>;

  const usage = messageRecord["usage"];
  if (typeof usage !== "object" || usage === null) return null;
  const usageRecord = usage as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  const model = typeof messageRecord["model"] === "string" ? messageRecord["model"] : "";
  if (model.length === 0) return null;

  const messageId = typeof messageRecord["id"] === "string" ? messageRecord["id"] : null;
  const requestId = typeof record["requestId"] === "string" ? record["requestId"] : null;
  // Matches ccusage: prefer the message/request pair, fall back to whichever
  // half exists. Records with neither cannot be de-duplicated.
  const dedupeKey =
    messageId === null && requestId === null ? null : `${messageId ?? ""}:${requestId ?? ""}`;

  const cost = record["costUSD"];
  const attribution = takeClaudeUsageContext(record, state);

  return {
    provider: "claude",
    timestampMs,
    model,
    sessionId: typeof record["sessionId"] === "string" ? record["sessionId"] : "",
    totals: {
      uncachedInputTokens: int(usageRecord["input_tokens"]),
      cachedInputTokens: int(usageRecord["cache_read_input_tokens"]),
      cacheCreationTokens: int(usageRecord["cache_creation_input_tokens"]),
      outputTokens: int(usageRecord["output_tokens"]),
      // Anthropic folds thinking tokens into output and does not break them out.
      reasoningTokens: 0,
    },
    ...attribution,
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    fast: usageRecord["speed"] === "fast",
    dedupeKey,
  };
}

/**
 * Rolling state for a single Codex rollout file.
 *
 * Codex `token_count` events carry no model, so the model is carried forward
 * from the most recent `turn_context`. Sessions that switch models mid-run
 * attribute correctly from the switch onward.
 */
export interface CodexScanState extends CodexUsageContext {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  /** While true, leading usage events are re-stamped copies of parent history. */
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
    ...initialCodexUsageContext(),
  };
}

/** Parent history is copied in a short burst; a one-second gap marks genuine child usage. */
const FORK_COPY_MAX_GAP_MS = 1000;

/** Whether a `session_meta` payload marks the rollout as a fork or subagent. */
function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

/** Sum last_token_usage deltas and drop consecutive duplicate events to match session totals. */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return parseCodexRecord(parsed, state);
}

function parseCodexRecord(parsed: unknown, state: CodexScanState): UsageRecord | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const payload = record["payload"];
  if (typeof payload !== "object" || payload === null) return null;
  const payloadRecord = payload as Record<string, unknown>;
  const payloadType = payloadRecord["type"];

  if (record["type"] === "session_meta") {
    // Only the first meta describes this file's own session. A forked rollout
    // repeats the ancestors' metas right after it; letting those through would
    // reassign every subsequent record to an ancestor session.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payloadRecord["id"] ?? payloadRecord["session_id"];
    if (typeof id === "string") state.sessionId = id;
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    observeCodexSessionContext(
      payloadRecord,
      state,
      metaTimestampMs !== null && isForkedSessionMeta(payloadRecord),
    );
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    return null;
  }

  if (record["type"] === "response_item") {
    observeCodexResponseContext(payloadRecord, state);
    return null;
  }

  if (record["type"] === "event_msg" && payloadType === "context_compacted") {
    state.pendingDiagnostics.compactionEvents += 1;
    return null;
  }

  if (payloadType !== "token_count") return null;

  const info = payloadRecord["info"];
  if (typeof info !== "object" || info === null) return null;
  const last = (info as Record<string, unknown>)["last_token_usage"];
  if (typeof last !== "object" || last === null) return null;
  const lastRecord = last as Record<string, unknown>;
  const maxContextTokens = int((info as Record<string, unknown>)["model_context_window"]);

  // Only an event that is otherwise eligible may consume the duplicate
  // signature. A token_count arriving before its turn_context (no model yet)
  // must not poison it, or the re-emitted copy after the model is known would
  // be skipped as a duplicate and those tokens never counted.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;
  if (state.model.length === 0) return null;

  // Codex re-emits an unchanged token_count on some stream boundaries. Summing
  // those would double count, so identical consecutive payloads are skipped.
  const signature = JSON.stringify(lastRecord);
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  // In a forked rollout the copied parent history was already counted from the
  // parent's own file. Drop the leading burst; the first usage event separated
  // from its predecessor by a real turn's worth of time ends it for good.
  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }

  const inputTokens = int(lastRecord["input_tokens"]);
  const cachedInputTokens = int(lastRecord["cached_input_tokens"]);
  const cacheCreationTokens = int(lastRecord["cache_write_input_tokens"]);
  const outputTokens = int(lastRecord["output_tokens"]);

  const totals: UsageTokenTotals = {
    // Codex reports `input_tokens` inclusive of the cached portion.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: Math.min(outputTokens, int(lastRecord["reasoning_output_tokens"])),
  };

  if (totalTokens(totals) === 0) return null;
  const attribution = takeCodexUsageContext(state, maxContextTokens);

  return {
    provider: "codex",
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    ...attribution,
    // Codex does not report cost in the rollout.
    reportedCostUsd: null,
    fast: false,
    // Events surviving the fork-copy suppression above are unique to this
    // rollout, so they need no global dedup.
    dedupeKey: null,
  };
}

interface GrokUsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly reasoningTokens: number;
  readonly costUsdTicks: number | null;
}

function readGrokUsageTotals(value: unknown): GrokUsageTotals | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return {
    inputTokens: int(record["inputTokens"]),
    outputTokens: int(record["outputTokens"]),
    cachedReadTokens: int(record["cachedReadTokens"]),
    cacheCreationTokens: int(record["cacheCreationTokens"]),
    reasoningTokens: int(record["reasoningTokens"]),
    costUsdTicks:
      typeof record["costUsdTicks"] === "number" && Number.isFinite(record["costUsdTicks"])
        ? record["costUsdTicks"]
        : null,
  };
}

function grokTotalsToUsage(totals: GrokUsageTotals): UsageTokenTotals {
  const cachedInputTokens = totals.cachedReadTokens;
  const cacheCreationTokens = totals.cacheCreationTokens;
  // Grok reports `inputTokens` inclusive of the cached portion, matching Codex.
  const uncachedInputTokens = Math.max(
    0,
    totals.inputTokens - cachedInputTokens - cacheCreationTokens,
  );
  const outputTokens = totals.outputTokens;
  return {
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, totals.reasoningTokens),
  };
}

/** Return one usage record per model from turn_completed updates, or the aggregate fallback. */
export function parseGrokLine(line: string): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return parseGrokRecord(parsed);
}

function parseGrokRecord(parsed: unknown): readonly UsageRecord[] {
  if (typeof parsed !== "object" || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const params = record["params"];
  if (typeof params !== "object" || params === null) return [];
  const paramsRecord = params as Record<string, unknown>;

  const update = paramsRecord["update"];
  if (typeof update !== "object" || update === null) return [];
  const updateRecord = update as Record<string, unknown>;
  if (updateRecord["sessionUpdate"] !== "turn_completed") return [];

  const usage = updateRecord["usage"];
  if (typeof usage !== "object" || usage === null) return [];
  const usageRecord = usage as Record<string, unknown>;

  const sessionId = typeof paramsRecord["sessionId"] === "string" ? paramsRecord["sessionId"] : "";
  const promptId = typeof updateRecord["prompt_id"] === "string" ? updateRecord["prompt_id"] : null;

  // Prefer the high-resolution agent clock; fall back to the outer unix seconds.
  const meta = paramsRecord["_meta"];
  let timestampMs: number | null = null;
  if (typeof meta === "object" && meta !== null) {
    const agentTimestampMs = (meta as Record<string, unknown>)["agentTimestampMs"];
    if (typeof agentTimestampMs === "number" && Number.isFinite(agentTimestampMs)) {
      timestampMs = agentTimestampMs;
    }
  }
  if (timestampMs === null) {
    const timestamp = record["timestamp"];
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      timestampMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
    }
  }
  if (timestampMs === null) return [];

  const topLevel = readGrokUsageTotals(usageRecord);
  if (topLevel === null) return [];

  const modelUsage = usageRecord["modelUsage"];
  const modelEntries: Array<{ model: string; totals: GrokUsageTotals }> = [];
  if (typeof modelUsage === "object" && modelUsage !== null) {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, unknown>)) {
      if (model.length === 0) continue;
      const totals = readGrokUsageTotals(raw);
      if (totals === null) continue;
      modelEntries.push({ model, totals });
    }
  }

  if (modelEntries.length === 0) {
    if (totalTokens(grokTotalsToUsage(topLevel)) === 0) return [];
    return [
      {
        provider: "grok",
        timestampMs,
        model: "grok",
        sessionId,
        totals: grokTotalsToUsage(topLevel),
        callKind: "unknown",
        reportedCostUsd: grokCostTicksToUsd(topLevel.costUsdTicks),
        fast: false,
        // No prompt id means we cannot tell two same-second updates apart.
        dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:grok`,
      },
    ];
  }

  // Preserve reported per-model costs, then divide the remaining aggregate among
  // unticked models by token share. Zero-token rows take no share.
  const topLevelCostUsd = grokCostTicksToUsd(topLevel.costUsdTicks);
  let usedTickedCostUsd = 0;
  let untickedTokenDenominator = 0;
  for (const entry of modelEntries) {
    const tokens = totalTokens(grokTotalsToUsage(entry.totals));
    if (tokens === 0) continue;
    if (entry.totals.costUsdTicks !== null) {
      usedTickedCostUsd += grokCostTicksToUsd(entry.totals.costUsdTicks) ?? 0;
    } else {
      untickedTokenDenominator += tokens;
    }
  }
  const remainingCostUsd =
    topLevelCostUsd === null ? null : Math.max(0, topLevelCostUsd - usedTickedCostUsd);

  const results: UsageRecord[] = [];
  for (const entry of modelEntries) {
    const totals = grokTotalsToUsage(entry.totals);
    if (totalTokens(totals) === 0) continue;

    let reportedCostUsd = grokCostTicksToUsd(entry.totals.costUsdTicks);
    if (reportedCostUsd === null && remainingCostUsd !== null && untickedTokenDenominator > 0) {
      reportedCostUsd = remainingCostUsd * (totalTokens(totals) / untickedTokenDenominator);
    }

    results.push({
      provider: "grok",
      timestampMs,
      model: entry.model,
      sessionId,
      totals,
      callKind: "unknown",
      reportedCostUsd,
      fast: false,
      dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:${entry.model}`,
    });
  }
  return results;
}
