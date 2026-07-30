// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import {
  normalizeCursorSdkCatalog,
  resolveCursorModelSelection,
  type CursorSdkModelSelection,
} from "./CursorSdkCatalog.ts";
import { normalizeCursorSdkApiKey, isPlausibleCursorSessionJwt } from "./CursorSdkKey.ts";
import { addDiagnostic, buildCursorTurnOutcome } from "./CursorSdkOutcome.ts";

type DynamicImporter = (specifier: string) => Promise<unknown>;

interface CursorSdkModule {
  readonly Agent: {
    readonly create: (options: Record<string, unknown>) => Promise<CursorSdkAgent>;
  };
  readonly Cursor: {
    readonly models: { readonly list: (input: { readonly apiKey: string }) => Promise<unknown> };
    readonly me: (input: { readonly apiKey: string }) => Promise<unknown>;
  };
}

interface CursorSdkAgent {
  readonly agentId?: string | undefined;
  readonly send: (input: unknown, options?: Record<string, unknown>) => Promise<CursorSdkRun>;
  readonly close?: () => void | Promise<void>;
  readonly [Symbol.asyncDispose]?: () => Promise<void>;
}

export interface CursorSdkRun {
  readonly stream: () => AsyncIterable<unknown>;
  readonly wait: () => Promise<unknown>;
  readonly supports?: (capability: string) => boolean;
  readonly cancel?: () => Promise<void>;
}

export interface CursorSdkImage {
  readonly data: string;
  readonly mimeType: string;
}

export interface CursorSdkTurnState {
  agent: CursorSdkAgent | undefined;
  activeRun: CursorSdkRun | undefined;
  apiKey: string | undefined;
  cwd: string | undefined;
  wireModelId: string | undefined;
}

export interface CursorSdkTurnInput {
  readonly apiKey: string;
  readonly cwd: string | undefined;
  readonly wireModelId: string;
  readonly userText: string;
  readonly images?: ReadonlyArray<CursorSdkImage> | undefined;
  readonly mcpServers?: Record<string, unknown> | undefined;
  readonly systemPreamble?: string | undefined;
  readonly state: CursorSdkTurnState;
  readonly signal?: AbortSignal | undefined;
  readonly emit?: ((event: CursorSdkStreamEvent) => void) | undefined;
  readonly importer?: DynamicImporter | undefined;
}

export type CursorSdkStreamEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly status?: string | undefined;
      readonly callId?: string | undefined;
    };

export interface CursorSdkTurnResult {
  readonly ok: boolean;
  readonly text: string;
  readonly status?: string | undefined;
  readonly error?: string | undefined;
  readonly warning?: string | undefined;
  readonly agentId?: string | undefined;
}

const catalogSelectionByApiKey = new Map<string, Map<string, CursorSdkModelSelection>>();

function defaultImporter(specifier: string): Promise<unknown> {
  return import(specifier);
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeErrMessage(error: unknown): string {
  if (error instanceof Error) {
    const raw = error.message.trim();
    if (raw && raw !== "Error") return raw;
    const cause = getRecord(error.cause);
    if (typeof cause.message === "string" && cause.message.trim()) return cause.message.trim();
    if (error.name && error.name !== "Error") return error.name;
    const record = getRecord(error);
    if (typeof record.code === "string" && record.code.trim()) return record.code.trim();
    return "Unknown error (Cursor SDK did not provide a message)";
  }
  const message = String(error).trim();
  return message || "Unknown error";
}

async function loadCursorSdk(importer: DynamicImporter | undefined): Promise<CursorSdkModule> {
  const loaded = await (importer ?? defaultImporter)("@cursor/sdk");
  const record = getRecord(loaded);
  const agent = getRecord(record.Agent);
  const cursor = getRecord(record.Cursor);
  if (typeof agent.create !== "function" || typeof getRecord(cursor.models).list !== "function") {
    throw new Error("@cursor/sdk does not expose the expected Agent/Cursor API.");
  }
  return record as unknown as CursorSdkModule;
}

function catalogCacheKey(apiKey: string): string {
  return NodeCrypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 20);
}

async function modelSelectionForWire(input: {
  readonly apiKey: string;
  readonly wireModelId: string;
  readonly cursor: CursorSdkModule["Cursor"];
}): Promise<CursorSdkModelSelection> {
  const cacheKey = catalogCacheKey(input.apiKey);
  let cached = catalogSelectionByApiKey.get(cacheKey);
  if (!cached) {
    try {
      const models = await input.cursor.models.list({ apiKey: input.apiKey });
      cached = normalizeCursorSdkCatalog(Array.isArray(models) ? models : []).selectionByWireId;
      catalogSelectionByApiKey.set(cacheKey, cached);
    } catch (error) {
      if (!isPlausibleCursorSessionJwt(input.apiKey)) throw error;
      cached = new Map();
    }
  }
  return resolveCursorModelSelection(input.wireModelId, cached);
}

function parseMcpServers(raw: string | undefined): Record<string, unknown> | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function createCursorStreamAccumulator(emit: ((event: CursorSdkStreamEvent) => void) | undefined) {
  let text = "";
  let thinking = "";
  const appendTextDelta = (delta: string) => {
    if (!delta) return;
    text += delta;
    emit?.({ kind: "text", text: delta });
  };
  const mergeTextSnapshot = (snapshot: string) => {
    if (!snapshot) return;
    if (snapshot.startsWith(text)) {
      appendTextDelta(snapshot.slice(text.length));
      return;
    }
    if (!text) appendTextDelta(snapshot);
  };
  const appendThinkingDelta = (delta: string) => {
    if (!delta) return;
    thinking += delta;
    emit?.({ kind: "thinking", text: delta });
  };
  const mergeThinkingSnapshot = (snapshot: string) => {
    if (!snapshot) return;
    if (snapshot.startsWith(thinking)) {
      appendThinkingDelta(snapshot.slice(thinking.length));
      return;
    }
    if (!thinking) appendThinkingDelta(snapshot);
  };
  return {
    appendTextDelta,
    mergeTextSnapshot,
    appendThinkingDelta,
    mergeThinkingSnapshot,
    getText: () => text,
  };
}

async function disposeAgent(agent: CursorSdkAgent | undefined): Promise<boolean> {
  if (!agent) return false;
  const asyncDispose = agent[Symbol.asyncDispose];
  if (asyncDispose) {
    try {
      await asyncDispose.call(agent);
      return true;
    } catch {
      // Fall back to close below.
    }
  }
  if (!agent.close) return false;
  await agent.close();
  return true;
}

async function cancelRun(run: CursorSdkRun | undefined): Promise<boolean> {
  try {
    if (!run?.cancel || run.supports?.("cancel") === false) return false;
    await run.cancel();
    return true;
  } catch {
    // Agent close remains the authoritative fallback.
    return false;
  }
}

export async function stopCursorSdkState(state: CursorSdkTurnState): Promise<void> {
  const agent = state.agent;
  const activeRun = state.activeRun;
  state.agent = undefined;
  state.activeRun = undefined;
  const cancellation = cancelRun(activeRun);
  if (agent) {
    await disposeAgent(agent);
    return;
  }
  await cancellation;
}

export async function forceStopCursorSdkState(state: CursorSdkTurnState): Promise<
  | {
      readonly outcome: "terminated";
      readonly mechanism: "runtime-close" | "remote-cancel" | "already-stopped";
      readonly detail?: string;
    }
  | {
      readonly outcome: "detached";
      readonly mechanism: "local-detach";
      readonly detail: string;
    }
> {
  const agent = state.agent;
  const activeRun = state.activeRun;
  state.agent = undefined;
  state.activeRun = undefined;
  if (!agent && !activeRun) {
    return {
      outcome: "terminated",
      mechanism: "already-stopped",
    };
  }

  const cancellation = cancelRun(activeRun);
  const runtimeClosed = await disposeAgent(agent).catch(() => false);
  if (runtimeClosed) {
    return {
      outcome: "terminated",
      mechanism: "runtime-close",
      detail: "The Cursor SDK agent runtime was closed.",
    };
  }
  if (await cancellation) {
    return {
      outcome: "terminated",
      mechanism: "remote-cancel",
      detail: "The active Cursor SDK run was cancelled.",
    };
  }
  return {
    outcome: "detached",
    mechanism: "local-detach",
    detail:
      "The Cursor SDK request was detached locally, but neither run cancellation nor agent close could be confirmed.",
  };
}

async function ensureProjectDirectory(cwd: string): Promise<void> {
  const stat = await NodeFSP.stat(cwd);
  if (!stat.isDirectory()) throw new Error("Path is not a directory.");
}

function normalizeImages(
  images: ReadonlyArray<CursorSdkImage> | undefined,
): ReadonlyArray<CursorSdkImage> {
  return (images ?? []).filter((image) => image.data.trim()).slice(0, 16);
}

export function parseCursorSdkMcpServers(
  raw: string | undefined,
): Record<string, unknown> | undefined {
  return parseMcpServers(raw);
}

export async function readCursorSdkStatus(input: {
  readonly apiKey: string;
  readonly importer?: DynamicImporter | undefined;
}): Promise<{
  readonly authenticated: boolean;
  readonly user?: unknown | undefined;
  readonly sessionTokenFallback?: boolean | undefined;
}> {
  const apiKey = normalizeCursorSdkApiKey(input.apiKey);
  if (!apiKey) return { authenticated: false };
  const { Cursor } = await loadCursorSdk(input.importer);
  try {
    return { authenticated: true, user: await Cursor.me({ apiKey }) };
  } catch (error) {
    if (isPlausibleCursorSessionJwt(apiKey)) {
      return { authenticated: true, sessionTokenFallback: true };
    }
    throw error;
  }
}

export async function listCursorSdkModels(input: {
  readonly apiKey: string;
  readonly importer?: DynamicImporter | undefined;
}) {
  const apiKey = normalizeCursorSdkApiKey(input.apiKey);
  if (!apiKey)
    return { pickerRows: [], selectionByWireId: new Map<string, CursorSdkModelSelection>() };
  const { Cursor } = await loadCursorSdk(input.importer);
  const models = await Cursor.models.list({ apiKey });
  const normalized = normalizeCursorSdkCatalog(Array.isArray(models) ? models : []);
  catalogSelectionByApiKey.set(catalogCacheKey(apiKey), normalized.selectionByWireId);
  return normalized;
}

export async function runCursorSdkTurn(input: CursorSdkTurnInput): Promise<CursorSdkTurnResult> {
  const apiKey = normalizeCursorSdkApiKey(input.apiKey);
  const cwd = input.cwd?.trim() ?? "";
  const wireModelId = input.wireModelId.trim();
  if (!apiKey || !cwd || !wireModelId) {
    throw new Error("Invalid Cursor SDK turn configuration.");
  }
  await ensureProjectDirectory(cwd).catch(() => {
    throw new Error(`Cursor SDK project folder is missing or inaccessible (${cwd}).`);
  });

  const { Agent, Cursor } = await loadCursorSdk(input.importer);
  const model = await modelSelectionForWire({ apiKey, wireModelId, cursor: Cursor });
  const stale =
    input.state.agent &&
    (input.state.apiKey !== apiKey ||
      input.state.cwd !== cwd ||
      input.state.wireModelId !== wireModelId);
  if (stale) {
    await stopCursorSdkState(input.state);
  }
  if (!input.state.agent) {
    input.state.agent = await Agent.create({
      apiKey,
      model,
      local: { cwd, settingSources: ["project"] },
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    });
    input.state.apiKey = apiKey;
    input.state.cwd = cwd;
    input.state.wireModelId = wireModelId;
  }

  const agent = input.state.agent;
  if (input.signal?.aborted) {
    const agentId = agent.agentId;
    await stopCursorSdkState(input.state);
    return {
      ok: false,
      text: "",
      error: "Cancelled",
      status: "cancelled",
      agentId,
    };
  }
  const images = normalizeImages(input.images);
  const text = input.systemPreamble?.trim()
    ? `${input.systemPreamble.trim()}\n\n---\n\n${input.userText}`
    : input.userText;
  const abortState = { aborted: false };
  let activeRun: CursorSdkRun | undefined;
  const abort = () => {
    abortState.aborted = true;
    void cancelRun(activeRun);
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const stream = createCursorStreamAccumulator(input.emit);
    const run = await agent.send(images.length ? { text, images } : text, {
      model,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      onDelta: ({ update }: { update?: unknown }) => {
        if (abortState.aborted) return;
        const updateRecord = getRecord(update);
        if (updateRecord.type === "text-delta" && typeof updateRecord.text === "string") {
          stream.appendTextDelta(updateRecord.text);
        }
        if (updateRecord.type === "thinking-delta" && typeof updateRecord.text === "string") {
          stream.appendThinkingDelta(updateRecord.text);
        }
      },
    });
    activeRun = run;
    if (input.state.agent !== agent || abortState.aborted) {
      await cancelRun(run);
      return {
        ok: false,
        text: "",
        error: "Cancelled",
        status: "cancelled",
        agentId: agent.agentId,
      };
    }
    input.state.activeRun = run;

    const diagnostics: string[] = [];
    for await (const message of run.stream()) {
      if (abortState.aborted) {
        await cancelRun(run);
        break;
      }
      addDiagnostic(diagnostics, message);
      const record = getRecord(message);
      if (record.type === "assistant") {
        const messageRecord = getRecord(record.message);
        const content = Array.isArray(messageRecord.content) ? messageRecord.content : [];
        let piece = "";
        for (const block of content) {
          const blockRecord = getRecord(block);
          if (blockRecord.type === "text" && typeof blockRecord.text === "string")
            piece += blockRecord.text;
        }
        stream.mergeTextSnapshot(piece);
      }
      if (record.type === "thinking" && typeof record.text === "string") {
        stream.mergeThinkingSnapshot(record.text);
      }
      if (record.type === "tool_call") {
        input.emit?.({
          kind: "tool",
          name: typeof record.name === "string" ? record.name : "",
          status: typeof record.status === "string" ? record.status : undefined,
          callId: typeof record.call_id === "string" ? record.call_id : undefined,
        });
      }
    }

    const result = await run.wait();
    if (abortState.aborted) {
      return {
        ok: false,
        text: "",
        error: "Cancelled",
        status: "cancelled",
        agentId: agent.agentId,
      };
    }
    return {
      ...buildCursorTurnOutcome(result, stream.getText(), diagnostics),
      agentId: agent.agentId,
    };
  } catch (error) {
    return { ok: false, text: "", error: safeErrMessage(error) };
  } finally {
    if (input.state.activeRun === activeRun) input.state.activeRun = undefined;
    input.signal?.removeEventListener("abort", abort);
  }
}
