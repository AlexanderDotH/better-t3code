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
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly callKind: UsageCallKind;
  readonly diagnostics?: UsageContextDiagnostics;
  readonly reportedCostUsd: number | null;
  /**
   * Key for cross-file de-duplication, or `null` when the record is inherently
   * unique and needs no dedup.
   */
  readonly dedupeKey: string | null;
}

const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

const EMPTY_DIAGNOSTICS: MutableUsageContextDiagnostics = {
  nativeForks: 0,
  compactHandoffs: 0,
  totalHandoffChars: 0,
  compactionEvents: 0,
  maxContextTokens: 0,
  instructionChars: 0,
  memoryInjectionChars: 0,
  toolSchemaChars: 0,
  subagentResultChars: 0,
  toolDigestChars: 0,
  autoRoutingChars: 0,
};

interface MutableUsageContextDiagnostics {
  nativeForks: number;
  compactHandoffs: number;
  totalHandoffChars: number;
  compactionEvents: number;
  maxContextTokens: number;
  instructionChars: number;
  memoryInjectionChars: number;
  toolSchemaChars: number;
  subagentResultChars: number;
  toolDigestChars: number;
  autoRoutingChars: number;
}

const T3_METADATA_CALL_MARKER = "<t3code_metadata_call>";
const T3_AUTO_REASONING_CALL_MARKER = "<t3code_auto_reasoning_call>";
const T3_CONTEXT_HANDOFF_OPEN = "<t3code_context_handoff>";
const T3_CONTEXT_HANDOFF_CLOSE = "</t3code_context_handoff>";
const T3_PROJECT_MEMORY_OPEN = "<t3code_project_memory>";
const T3_PROJECT_MEMORY_CLOSE = "</t3code_project_memory>";

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function addTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
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

function measureTaggedText(text: string, open: string, close: string): number {
  let total = 0;
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf(open, offset);
    if (start < 0) break;
    const closeIndex = text.indexOf(close, start + open.length);
    if (closeIndex < 0) break;
    const end = closeIndex + close.length;
    total += end - start;
    offset = end;
  }
  return total;
}

function measureContextHandoff(text: string): number {
  return measureTaggedText(text, T3_CONTEXT_HANDOFF_OPEN, T3_CONTEXT_HANDOFF_CLOSE);
}

function measureProjectMemory(text: string): number {
  return measureTaggedText(text, T3_PROJECT_MEMORY_OPEN, T3_PROJECT_MEMORY_CLOSE);
}

function contentFreeDiagnostics(
  diagnostics: MutableUsageContextDiagnostics,
): UsageContextDiagnostics {
  return {
    nativeForks: diagnostics.nativeForks,
    compactHandoffs: diagnostics.compactHandoffs,
    totalHandoffChars: diagnostics.totalHandoffChars,
    compactionEvents: diagnostics.compactionEvents,
    maxContextTokens: diagnostics.maxContextTokens,
    ...(diagnostics.instructionChars > 0 ? { instructionChars: diagnostics.instructionChars } : {}),
    ...(diagnostics.memoryInjectionChars > 0
      ? { memoryInjectionChars: diagnostics.memoryInjectionChars }
      : {}),
    ...(diagnostics.toolSchemaChars > 0 ? { toolSchemaChars: diagnostics.toolSchemaChars } : {}),
    ...(diagnostics.subagentResultChars > 0
      ? { subagentResultChars: diagnostics.subagentResultChars }
      : {}),
    ...(diagnostics.toolDigestChars > 0 ? { toolDigestChars: diagnostics.toolDigestChars } : {}),
    ...(diagnostics.autoRoutingChars > 0 ? { autoRoutingChars: diagnostics.autoRoutingChars } : {}),
  };
}

/**
 * Cheap substring gate applied before `JSON.parse`.
 *
 * Transcripts are mostly tool output; only a minority of lines carry usage. On
 * a 30-day window this skips roughly half the lines outright and is worth about
 * an order of magnitude.
 */
export function mightCarryUsage(line: string, provider: UsageProviderKind): boolean {
  if (provider === "claude") return line.includes('"usage"');
  if (provider === "grok") return line.includes('"turn_completed"');
  return line.includes('"token_count"');
}

/**
 * Grok reports cost in integer ticks where `1 USD = 10^10` ticks. See Grok
 * headless `total_cost_usd_ticks`. Convert to dollars for pricing.
 */
export const GROK_COST_USD_TICKS_PER_DOLLAR = 10_000_000_000;

export function grokCostTicksToUsd(ticks: unknown): number | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  return ticks / GROK_COST_USD_TICKS_PER_DOLLAR;
}

/* -------------------------------------------------------------------------- */
/* Claude Code                                                                */
/* -------------------------------------------------------------------------- */

export interface ClaudeScanState {
  callKind: UsageCallKind;
  pendingDiagnostics: MutableUsageContextDiagnostics;
}

export function initialClaudeScanState(): ClaudeScanState {
  return {
    callKind: "unknown",
    pendingDiagnostics: { ...EMPTY_DIAGNOSTICS },
  };
}

function readClaudeMessageText(record: Record<string, unknown>): string {
  if (record["type"] !== "user") return "";
  const message = record["message"];
  if (typeof message !== "object" || message === null) return "";
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (typeof item !== "object" || item === null) return [];
      const text = (item as Record<string, unknown>)["text"];
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function takeClaudeDiagnostics(state: ClaudeScanState): UsageContextDiagnostics | undefined {
  const diagnostics = contentFreeDiagnostics(state.pendingDiagnostics);
  state.pendingDiagnostics = { ...EMPTY_DIAGNOSTICS };
  return Object.values(diagnostics).some((value) => (value ?? 0) > 0) ? diagnostics : undefined;
}

/**
 * Parses one line of a Claude Code transcript.
 *
 * T3 Code writes one record per assistant *content block*, and every one of
 * those records repeats the same complete `usage` object for the parent
 * message. Summing them overcounts by roughly 2.4x on a real workload, so the
 * caller must drop repeats by `dedupeKey` and keep the first.
 */
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
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["type"] === "user") {
    const text = readClaudeMessageText(record);
    state.callKind = text.includes(T3_AUTO_REASONING_CALL_MARKER)
      ? "auto-reasoning"
      : text.includes(T3_METADATA_CALL_MARKER)
        ? "metadata"
        : "unknown";
    if (state.callKind === "auto-reasoning") {
      state.pendingDiagnostics.autoRoutingChars += text.length;
    }
    const handoffChars = measureContextHandoff(text);
    if (handoffChars > 0) {
      state.pendingDiagnostics.compactHandoffs = 1;
      state.pendingDiagnostics.totalHandoffChars = handoffChars;
    }
    state.pendingDiagnostics.memoryInjectionChars += measureProjectMemory(text);
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
  const observedCallKind =
    record["isSidechain"] === true
      ? "subagent"
      : record["isSidechain"] === false
        ? "root"
        : "unknown";
  const callKind =
    state.callKind === "metadata" || state.callKind === "auto-reasoning"
      ? state.callKind
      : observedCallKind;
  state.callKind = "unknown";
  const diagnostics = takeClaudeDiagnostics(state);

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
    callKind,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    dedupeKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Codex                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rolling state for a single Codex rollout file.
 *
 * Codex `token_count` events carry no model, so the model is carried forward
 * from the most recent `turn_context`. Sessions that switch models mid-run
 * attribute correctly from the switch onward.
 */
export interface CodexScanState {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  /** While true, leading usage events are re-stamped copies of parent history. */
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
  callKind: UsageCallKind;
  baseCallKind: UsageCallKind;
  pendingDiagnostics: MutableUsageContextDiagnostics;
  subagentToolCallIds: Set<string>;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
    callKind: "unknown",
    baseCallKind: "unknown",
    pendingDiagnostics: { ...EMPTY_DIAGNOSTICS },
    subagentToolCallIds: new Set(),
  };
}

/**
 * A forked or subagent rollout opens with the parent's full history copied in,
 * every line re-stamped to the fork instant. Those copies are written in one
 * synchronous burst (observed gaps 0-40ms), while the child's first genuine
 * usage event only lands after a real model turn (observed 5s+). One second of
 * separation splits the two cleanly; `ccusage` uses the same threshold.
 */
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

function isSubagentSessionMeta(payload: Record<string, unknown>): boolean {
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  return typeof subagent === "object" && subagent !== null;
}

function readInputText(payload: Record<string, unknown>): string {
  if (payload["type"] !== "message" || payload["role"] !== "user") return "";
  const content = payload["content"];
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const text = (item as Record<string, unknown>)["text"];
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function takeCodexDiagnostics(
  state: CodexScanState,
  maxContextTokens: number,
): UsageContextDiagnostics | undefined {
  const diagnostics = contentFreeDiagnostics({
    ...state.pendingDiagnostics,
    maxContextTokens: Math.max(state.pendingDiagnostics.maxContextTokens, maxContextTokens),
  });
  state.pendingDiagnostics = { ...EMPTY_DIAGNOSTICS };
  return Object.values(diagnostics).some((value) => (value ?? 0) > 0) ? diagnostics : undefined;
}

const SUBAGENT_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "list_agents",
]);

function responseOutputTexts(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(responseOutputTexts);
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record["text"], record["content"], record["output"]].flatMap(responseOutputTexts);
}

function recordSubagentResultSize(payload: Record<string, unknown>, state: CodexScanState): void {
  const type = payload["type"];
  if (type === "custom_tool_call" || type === "function_call") {
    const name = payload["name"];
    const callId = payload["call_id"] ?? payload["id"];
    if (typeof name === "string" && SUBAGENT_TOOL_NAMES.has(name) && typeof callId === "string") {
      state.subagentToolCallIds.add(callId);
    }
    return;
  }
  if (type !== "custom_tool_call_output" && type !== "function_call_output") return;
  const outputTexts = responseOutputTexts(payload["output"]);
  state.pendingDiagnostics.toolDigestChars += outputTexts
    .filter((text) => text.includes('"detailRef"') && text.includes("tool-result:"))
    .reduce((total, text) => total + text.length, 0);
  const callId = payload["call_id"] ?? payload["id"];
  if (typeof callId !== "string" || !state.subagentToolCallIds.delete(callId)) return;
  state.pendingDiagnostics.subagentResultChars += outputTexts.reduce(
    (total, text) => total + text.length,
    0,
  );
}

/**
 * Feeds one line of a Codex rollout into `state`, returning a record when the
 * line was a usage event.
 *
 * Deltas come from `last_token_usage`. Summing those across a session
 * reconciles with the session's final `total_token_usage`, provided
 * consecutive duplicate events are dropped, which this does.
 */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
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
    state.baseCallKind = isSubagentSessionMeta(payloadRecord) ? "subagent" : "root";
    state.callKind = state.baseCallKind;
    const instructions = payloadRecord["base_instructions"];
    if (typeof instructions === "string") {
      state.pendingDiagnostics.instructionChars += instructions.length;
    }
    const metaTimestampMs = parseTimestampMs(record["timestamp"]);
    if (metaTimestampMs !== null && isForkedSessionMeta(payloadRecord)) {
      state.pendingDiagnostics.nativeForks += 1;
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    return null;
  }

  if (record["type"] === "response_item") {
    recordSubagentResultSize(payloadRecord, state);
    const text = readInputText(payloadRecord);
    if (text.includes(T3_AUTO_REASONING_CALL_MARKER)) {
      state.callKind = "auto-reasoning";
      state.pendingDiagnostics.autoRoutingChars += text.length;
    } else if (text.includes(T3_METADATA_CALL_MARKER)) {
      state.callKind = "metadata";
    }
    const handoffChars = measureContextHandoff(text);
    if (handoffChars > 0) {
      // A fork copy can repeat older handoffs. The last handoff before the next
      // usage event is the one that supplied that call's context.
      state.pendingDiagnostics.compactHandoffs = 1;
      state.pendingDiagnostics.totalHandoffChars = handoffChars;
    }
    state.pendingDiagnostics.memoryInjectionChars += measureProjectMemory(text);
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
  const diagnostics = takeCodexDiagnostics(state, maxContextTokens);
  const callKind = state.callKind;
  state.callKind = state.baseCallKind;

  return {
    provider: "codex",
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    callKind,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    // Codex does not report cost in the rollout.
    reportedCostUsd: null,
    // Events surviving the fork-copy suppression above are unique to this
    // rollout, so they need no global dedup.
    dedupeKey: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Grok Build                                                                 */
/* -------------------------------------------------------------------------- */

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

/**
 * Parses one line of a Grok Build `updates.jsonl` session log.
 *
 * Usage lands on `turn_completed` session updates. Per-model breakdowns live
 * under `usage.modelUsage`; when present each model becomes its own record.
 *
 * Returns every record for the line (0 or more). Callers stream line-by-line
 * and flatten.
 */
export function parseGrokLine(line: string): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
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
        // No prompt id means we cannot tell two same-second updates apart.
        dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:grok`,
      },
    ];
  }

  // Cost allocation:
  // 1. Emitted models with their own costUsdTicks keep those values.
  // 2. Remaining aggregate cost (top-level minus those per-model ticks,
  //    clamped at 0) is pro-rated across emitted models that lack ticks,
  //    by token share among the unticked models only.
  // 3. When no model has per-model ticks, remaining equals the full
  //    aggregate and every emitted model gets a token-share slice.
  // Zero-token rows are never emitted and never count toward used ticks.
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
      dedupeKey: promptId === null ? null : `${sessionId}:${promptId}:${entry.model}`,
    });
  }
  return results;
}

export { EMPTY_TOTALS };
