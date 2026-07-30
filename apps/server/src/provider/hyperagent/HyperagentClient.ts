import * as NodeTimersPromises from "node:timers/promises";

import type { ChatAttachment } from "@t3tools/contracts";

import {
  HYPERAGENT_T3_CHAT_FLAGS,
  hyperagentCookieHeader,
  hyperagentSseStatusLabel,
  mapHyperagentUsageToTokenUsage,
  mapReasoningEffortToHyperagent,
  normalizeHyperagentBaseUrl,
  parseHyperagentSseChunk,
  trimHyperagentSystemPrompt,
  wrapHyperagentSystemPrompt,
} from "./HyperagentUtils.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HyperagentInlineAttachment {
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly base64: string;
  readonly includeInContext: boolean;
}

export interface HyperagentTurnInput {
  readonly sessionCookie: string;
  readonly baseUrl?: string | undefined;
  readonly modelId: string;
  readonly content: string;
  readonly systemPrompt?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly fastMode?: boolean | undefined;
  readonly attachments?: ReadonlyArray<HyperagentInlineAttachment> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly emit?: ((event: HyperagentTurnStreamEvent) => void) | undefined;
}

export type HyperagentTurnStreamEvent =
  | { readonly kind: "status"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

export interface HyperagentTurnResult {
  readonly text: string;
  readonly thinking: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly costUsd: number | null;
  readonly threadId: string;
}

export function friendlyHyperagentError(status: number, bodyText: string | undefined): string {
  const text = String(bodyText ?? "").toLowerCase();
  if (status === 401)
    return "Hyperagent session expired. Reconnect Hyperagent in provider settings.";
  if (status === 402 || text.includes("payment_failed") || text.includes("payment failed")) {
    return "Hyperagent billing blocked this request. Check your Hyperagent account billing.";
  }
  if (status === 403)
    return "Hyperagent rejected the request. Check the configured session cookie.";
  if (status >= 500) return `Hyperagent server error (${status}). Try again shortly.`;
  const detail = bodyText ? `: ${String(bodyText).slice(0, 200)}` : "";
  return `Hyperagent request failed (${status})${detail}`;
}

function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
  if (fetchImpl) return fetchImpl;
  // @effect-diagnostics globalFetch:off
  return (input, init) => globalThis.fetch(input, init);
}

export async function hyperagentFetch(
  path: string,
  input: {
    readonly method?: "GET" | "POST" | "PATCH" | undefined;
    readonly baseUrl?: string | undefined;
    readonly sessionCookie: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal | undefined;
    readonly fetchImpl?: FetchLike | undefined;
  },
): Promise<Response> {
  const cookie = hyperagentCookieHeader(input.sessionCookie);
  if (!cookie) throw new Error("Hyperagent session cookie missing.");
  const fetchImpl = resolveFetch(input.fetchImpl);
  const baseUrl = normalizeHyperagentBaseUrl(input.baseUrl);
  return fetchImpl(`${baseUrl}${path}`, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json, text/event-stream, text/plain, */*",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      "User-Agent": "t3-code/0.0.0",
    },
    ...(input.body == null ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

async function readJsonOrThrow(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(friendlyHyperagentError(response.status, text));
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sanitizeHyperagentAttachment(
  attachment: ChatAttachment,
  base64: string,
): HyperagentInlineAttachment | undefined {
  const encoded = base64.trim();
  if (!encoded) return undefined;
  return {
    name: attachment.name.trim() || "image.png",
    size: Math.max(0, attachment.sizeBytes),
    mimeType: attachment.mimeType.split(";")[0]?.trim().toLowerCase() || "image/png",
    base64: encoded,
    includeInContext: true,
  };
}

async function pollUsage(input: {
  readonly threadId: string;
  readonly sessionCookie: string;
  readonly baseUrl?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}) {
  let last: unknown = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (input.signal?.aborted) break;
    const response = await hyperagentFetch(`/api/threads/${input.threadId}/usage`, input);
    const data = await readJsonOrThrow(response);
    last = data;
    if (getRecord(data).calculating !== true) break;
    await NodeTimersPromises.setTimeout(1500, undefined, { signal: input.signal });
  }
  return mapHyperagentUsageToTokenUsage(last);
}

async function fetchLatestAssistantMessage(input: {
  readonly threadId: string;
  readonly sessionCookie: string;
  readonly baseUrl?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}): Promise<string> {
  const response = await hyperagentFetch(`/api/threads/${input.threadId}/messages?limit=5`, input);
  const data = getRecord(await readJsonOrThrow(response));
  const messages = Array.isArray(data.messages) ? data.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = getRecord(messages[index]);
    if (message.role === "assistant" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

async function streamChat(input: HyperagentTurnInput & { readonly threadId: string }): Promise<{
  readonly text: string;
  readonly thinking: string;
}> {
  const response = await hyperagentFetch(`/api/threads/${input.threadId}/chat`, {
    method: "POST",
    baseUrl: input.baseUrl,
    sessionCookie: input.sessionCookie,
    body: {
      content: input.content,
      ...HYPERAGENT_T3_CHAT_FLAGS,
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
  });

  if (!response.ok) {
    throw new Error(friendlyHyperagentError(response.status, await response.text()));
  }

  let text = "";
  let thinking = "";
  let sseRemainder = "";
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = getRecord(await response.json());
    return { text: readString(data.content), thinking };
  }

  if (!response.body) {
    const parsed = parseHyperagentSseChunk(await response.text());
    return { text: parsed.result.text, thinking: parsed.result.thinking };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseRemainder += decoder.decode(value, { stream: true });
      const parsed = parseHyperagentSseChunk(sseRemainder, text, thinking);
      sseRemainder = parsed.remainder;
      const previousTextLength = text.length;
      const previousThinkingLength = thinking.length;
      text = parsed.result.text;
      thinking = parsed.result.thinking;
      for (const event of parsed.result.events) {
        const status = hyperagentSseStatusLabel(event);
        if (status) input.emit?.({ kind: "status", text: status });
      }
      if (thinking.length > previousThinkingLength) {
        input.emit?.({ kind: "thinking", text: thinking.slice(previousThinkingLength) });
      }
      if (text.length > previousTextLength) {
        input.emit?.({ kind: "text", text: text.slice(previousTextLength) });
      }
      if (parsed.result.done) break;
    }
    if (sseRemainder.trim()) {
      const final = parseHyperagentSseChunk(`${sseRemainder}\n`, text, thinking);
      text = final.result.text;
      thinking = final.result.thinking;
    }
  } finally {
    reader.releaseLock();
  }

  return { text, thinking };
}

export async function runHyperagentTurn(input: HyperagentTurnInput): Promise<HyperagentTurnResult> {
  const sessionCookie = input.sessionCookie.trim();
  const baseUrl = normalizeHyperagentBaseUrl(input.baseUrl);
  const modelId = input.modelId.trim();
  const content = input.content;
  if (!sessionCookie) throw new Error("Hyperagent session cookie missing.");
  if (!modelId) throw new Error("Hyperagent model id missing.");
  if (!content.trim() && (input.attachments?.length ?? 0) === 0) {
    throw new Error("Hyperagent chat content is empty.");
  }

  const systemPrompt = trimHyperagentSystemPrompt(wrapHyperagentSystemPrompt(input.systemPrompt));
  const mapped = mapReasoningEffortToHyperagent(input.reasoningEffort ?? "high");
  let threadId = "";

  try {
    const createResponse = await hyperagentFetch("/api/threads", {
      method: "POST",
      baseUrl,
      sessionCookie,
      body: { source: "t3-code.server" },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    const thread = getRecord(await readJsonOrThrow(createResponse));
    threadId = readString(thread.id);
    if (!threadId) throw new Error("Hyperagent did not return a thread id.");

    const patchResponse = await hyperagentFetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      baseUrl,
      sessionCookie,
      body: {
        systemPrompt,
        modelId,
        effort: mapped.effort,
        maxThinkingTokens: mapped.maxThinkingTokens,
        fastMode: input.fastMode === true,
        executionMode: "auto",
        integrationMode: "disabled",
        enabledIntegrations: [],
        enableThreadSearch: false,
      },
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });
    await readJsonOrThrow(patchResponse);

    let { text, thinking } = await streamChat({
      ...input,
      baseUrl,
      sessionCookie,
      modelId,
      threadId,
    });
    if (!text.trim()) {
      const fallback = await fetchLatestAssistantMessage({
        threadId,
        baseUrl,
        sessionCookie,
        signal: input.signal,
        fetchImpl: input.fetchImpl,
      });
      if (fallback.trim()) text = fallback;
    }
    const { usage, costUsd } = await pollUsage({
      threadId,
      baseUrl,
      sessionCookie,
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    });

    return { text, thinking, usage, costUsd, threadId };
  } finally {
    if (threadId) {
      try {
        await hyperagentFetch(`/api/threads/${threadId}`, {
          method: "PATCH",
          baseUrl,
          sessionCookie,
          body: { isArchived: true },
          fetchImpl: input.fetchImpl,
        });
      } catch {
        // Best-effort remote cleanup.
      }
    }
  }
}

export async function readHyperagentStatus(input: {
  readonly sessionCookie: string;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<{
  readonly connected: boolean;
  readonly email?: string | undefined;
  readonly userId?: string | undefined;
}> {
  const cookie = input.sessionCookie.trim();
  if (!cookie) return { connected: false };
  const response = await hyperagentFetch("/api/auth/me", { ...input, sessionCookie: cookie });
  if (response.status === 401) return { connected: false };
  const data = getRecord(await readJsonOrThrow(response));
  return {
    connected: true,
    ...(typeof data.email === "string" ? { email: data.email } : {}),
    ...(typeof data.userId === "string" ? { userId: data.userId } : {}),
    ...(typeof data.id === "string" && typeof data.userId !== "string" ? { userId: data.id } : {}),
  };
}
