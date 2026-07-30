export const HYPERAGENT_BASE_URL = "https://hyperagent.com";

export const HYPERAGENT_DEFAULT_CHAT_FLAGS = {
  sessionId: null,
  searchMode: "exa",
  enableExecuteScript: false,
  enablePersistentSandbox: true,
  enableWebpage: true,
  webpageGenerationModel: "inline",
  enableSlides: false,
  tablesEnabled: true,
  globalTablesEnabled: true,
  documentsEnabled: true,
  enableWebSearch: true,
  enableBrowser: true,
  enableImageGeneration: false,
  enableVideoGeneration: false,
  enableAudioGeneration: false,
  enableTranscription: false,
  enableAvatarVideo: false,
  enableExaFindSimilar: true,
  enableExaAnswer: true,
  enableExaResearch: false,
  enableExaWebsets: false,
  enableGeoTools: false,
  enableThreadSearch: true,
  hyperAppsEnabled: false,
  debug: false,
  debugMode: false,
  enabledIntegrations: [] as ReadonlyArray<string>,
  integrationMode: "open",
} as const;

export const HYPERAGENT_T3_CHAT_FLAGS = {
  ...HYPERAGENT_DEFAULT_CHAT_FLAGS,
  searchMode: "none",
  integrationMode: "disabled",
  enabledIntegrations: [] as ReadonlyArray<string>,
  enableThreadSearch: false,
  enableWebSearch: false,
  enableBrowser: false,
  enableWebpage: false,
  enableExaFindSimilar: false,
  enableExaAnswer: false,
  enableExaResearch: false,
  enableExaWebsets: false,
  enableGeoTools: false,
  enableExecuteScript: false,
  enablePersistentSandbox: false,
  enableSlides: false,
  tablesEnabled: false,
  globalTablesEnabled: false,
  documentsEnabled: false,
  hyperAppsEnabled: false,
} as const;

const HYPERAGENT_T3_ISOLATION_PREAMBLE =
  "T3 Code embed mode: assist only inside the active T3 Code workspace. Treat this as an isolated session. Do not use Hyperagent account memories, thread search, connected integrations, global documents, tables, other Hyperagent threads, or unrelated projects unless the user explicitly includes that context in this T3 Code conversation. Use only the T3 Code system context and the user message.";

export function normalizeHyperagentBaseUrl(raw: unknown): string {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/\/+$/, "");
  return trimmed || HYPERAGENT_BASE_URL;
}

export function wrapHyperagentSystemPrompt(systemPrompt: string | null | undefined): string {
  const trimmed = String(systemPrompt ?? "").trim();
  return trimmed
    ? `${HYPERAGENT_T3_ISOLATION_PREAMBLE}\n\n${trimmed}`
    : HYPERAGENT_T3_ISOLATION_PREAMBLE;
}

export function mapReasoningEffortToHyperagent(effort: string | null | undefined): {
  readonly effort: "minimum" | "low" | "medium" | "high" | "maximum";
  readonly maxThinkingTokens: number;
} {
  switch (effort) {
    case "minimal":
      return { effort: "minimum", maxThinkingTokens: 4096 };
    case "low":
      return { effort: "low", maxThinkingTokens: 8192 };
    case "medium":
      return { effort: "medium", maxThinkingTokens: 16000 };
    case "xhigh":
      return { effort: "maximum", maxThinkingTokens: 32000 };
    case "high":
    default:
      return { effort: "high", maxThinkingTokens: 32000 };
  }
}

export function trimHyperagentSystemPrompt(
  systemPrompt: string | null | undefined,
  maxLen = 32000,
): string {
  const value = String(systemPrompt ?? "").trim();
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 20))}\n[truncated]`;
}

export interface HyperagentSseParseResult {
  readonly text: string;
  readonly thinking: string;
  readonly done: boolean;
  readonly events: ReadonlyArray<unknown>;
}

function readStringField(value: unknown, field: string): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : "";
}

export function parseHyperagentSseChunk(
  buffer: string,
  priorText = "",
  priorThinking = "",
): { readonly result: HyperagentSseParseResult; readonly remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  let text = priorText;
  let thinking = priorThinking;
  let done = false;
  const events: Array<unknown> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "data: [DONE]") {
      done = true;
      continue;
    }
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      if (payload === "[DONE]") done = true;
      continue;
    }
    try {
      const event = JSON.parse(payload) as unknown;
      events.push(event);
      const type = readStringField(event, "type");
      const content = readStringField(event, "content");
      if (type === "text" && content) text += content;
      if (type === "thinking" && content) thinking += content;
      if (type === "done") done = true;
    } catch {
      // Ignore malformed SSE rows; the next chunk may still be valid.
    }
  }

  return { result: { text, thinking, done, events }, remainder };
}

function pickInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }
  return 0;
}

export function mapHyperagentUsageToTokenUsage(raw: unknown): {
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly costUsd: number | null;
} {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lastCapture =
    record.lastCapture && typeof record.lastCapture === "object"
      ? (record.lastCapture as Record<string, unknown>)
      : {};
  const promptTokens = pickInt(lastCapture.input_tokens);
  const completionTokens = pickInt(lastCapture.output_tokens);
  const totals =
    record.totals && typeof record.totals === "object"
      ? (record.totals as Record<string, unknown>)
      : {};
  const rawCost = totals.total_cost_usd;
  const costUsd = typeof rawCost === "number" && Number.isFinite(rawCost) ? rawCost : null;
  return {
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    costUsd,
  };
}

export function normalizeHyperagentSessionCookie(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!value.includes("__Host-hyperagent_session=")) return value;
  const match = value.match(/__Host-hyperagent_session=([^;]+)/);
  return match?.[1]?.trim() ?? "";
}

export function hyperagentCookieHeader(sessionToken: unknown): string {
  const token = normalizeHyperagentSessionCookie(sessionToken);
  return token ? `__Host-hyperagent_session=${token}; hyperagent_logged_in=1` : "";
}

export function hyperagentSseStatusLabel(event: unknown): string | null {
  const type = readStringField(event, "type");
  const content = readStringField(event, "content").trim();
  if (!content) return null;
  if (type === "sandbox_status" || type === "session_start" || type === "tool_start") {
    return content;
  }
  return null;
}
