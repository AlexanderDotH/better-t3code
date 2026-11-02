import { UsageCallKind, type UsageContextDiagnostics } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

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

function takeClaudeDiagnostics(state: ClaudeUsageContext): UsageContextDiagnostics | undefined {
  const diagnostics = contentFreeDiagnostics(state.pendingDiagnostics);
  state.pendingDiagnostics = { ...EMPTY_DIAGNOSTICS };
  return Object.values(diagnostics).some((value) => (value ?? 0) > 0) ? diagnostics : undefined;
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
  state: CodexUsageContext,
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

function recordSubagentResultSize(
  payload: Record<string, unknown>,
  state: CodexUsageContext,
): void {
  const type = payload["type"];
  if (type === "custom_tool_call" || type === "function_call") {
    const name = payload["name"];
    const callId = payload["call_id"] ?? payload["id"];
    if (typeof name === "string" && SUBAGENT_TOOL_NAMES.has(name) && typeof callId === "string") {
      if (!state.subagentToolCallIds.includes(callId))
        state.subagentToolCallIds = [...state.subagentToolCallIds, callId];
    }
    return;
  }
  if (type !== "custom_tool_call_output" && type !== "function_call_output") return;
  const outputTexts = responseOutputTexts(payload["output"]);
  state.pendingDiagnostics.toolDigestChars += outputTexts
    .filter((text) => text.includes('"detailRef"') && text.includes("tool-result:"))
    .reduce((total, text) => total + text.length, 0);
  const callId = payload["call_id"] ?? payload["id"];
  if (typeof callId !== "string" || !state.subagentToolCallIds.includes(callId)) return;
  state.subagentToolCallIds = state.subagentToolCallIds.filter((id) => id !== callId);
  state.pendingDiagnostics.subagentResultChars += outputTexts.reduce(
    (total, text) => total + text.length,
    0,
  );
}
const DiagnosticCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const DiagnosticCounters = Schema.Struct({
  nativeForks: Schema.mutableKey(DiagnosticCount),
  compactHandoffs: Schema.mutableKey(DiagnosticCount),
  totalHandoffChars: Schema.mutableKey(DiagnosticCount),
  compactionEvents: Schema.mutableKey(DiagnosticCount),
  maxContextTokens: Schema.mutableKey(DiagnosticCount),
  instructionChars: Schema.mutableKey(DiagnosticCount),
  memoryInjectionChars: Schema.mutableKey(DiagnosticCount),
  toolSchemaChars: Schema.mutableKey(DiagnosticCount),
  subagentResultChars: Schema.mutableKey(DiagnosticCount),
  toolDigestChars: Schema.mutableKey(DiagnosticCount),
  autoRoutingChars: Schema.mutableKey(DiagnosticCount),
});
export const ClaudeUsageContext = Schema.Struct({
  callKind: Schema.mutableKey(UsageCallKind),
  pendingDiagnostics: Schema.mutableKey(DiagnosticCounters),
});
export type ClaudeUsageContext = typeof ClaudeUsageContext.Type;
export const CodexUsageContext = Schema.Struct({
  ...ClaudeUsageContext.fields,
  baseCallKind: Schema.mutableKey(UsageCallKind),
  subagentToolCallIds: Schema.mutableKey(Schema.Array(Schema.String)),
});
export type CodexUsageContext = typeof CodexUsageContext.Type;
export const initialClaudeUsageContext = (): ClaudeUsageContext => ({
  callKind: "unknown",
  pendingDiagnostics: { ...EMPTY_DIAGNOSTICS },
});
export const initialCodexUsageContext = (): CodexUsageContext => ({
  ...initialClaudeUsageContext(),
  baseCallKind: "unknown",
  subagentToolCallIds: [],
});

export function observeClaudeUsageContext(
  record: Record<string, unknown>,
  state: ClaudeUsageContext,
): void {
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
  return;
}

export function takeClaudeUsageContext(record: Record<string, unknown>, state: ClaudeUsageContext) {
  const observedCallKind =
    record["isSidechain"] === true
      ? "subagent"
      : record["isSidechain"] === false
        ? "root"
        : "unknown";
  const callKind: UsageCallKind =
    state.callKind === "metadata" || state.callKind === "auto-reasoning"
      ? state.callKind
      : observedCallKind;
  state.callKind = "unknown";
  const diagnostics = takeClaudeDiagnostics(state);

  return { callKind, ...(diagnostics === undefined ? {} : { diagnostics }) };
}

export function observeCodexResponseContext(
  payloadRecord: Record<string, unknown>,
  state: CodexUsageContext,
): void {
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
}

export function observeCodexSessionContext(
  payloadRecord: Record<string, unknown>,
  state: CodexUsageContext,
  forked: boolean,
): void {
  state.baseCallKind = isSubagentSessionMeta(payloadRecord) ? "subagent" : "root";
  state.callKind = state.baseCallKind;
  const instructions = payloadRecord["base_instructions"];
  if (typeof instructions === "string") {
    state.pendingDiagnostics.instructionChars += instructions.length;
  }

  if (forked) state.pendingDiagnostics.nativeForks += 1;
}

export function takeCodexUsageContext(state: CodexUsageContext, maxContextTokens: number) {
  const diagnostics = takeCodexDiagnostics(state, maxContextTokens);
  const callKind = state.callKind;
  state.callKind = state.baseCallKind;

  return { callKind, ...(diagnostics === undefined ? {} : { diagnostics }) };
}
