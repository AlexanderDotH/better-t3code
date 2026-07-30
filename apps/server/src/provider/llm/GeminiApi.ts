import type { GeminiThinkingConfig } from "../Drivers/GeminiThinkingConfig.ts";

export interface GeminiInlineDataPart {
  readonly inline_data: {
    readonly mime_type: string;
    readonly data: string;
  };
}

export type GeminiRequestPart = { readonly text: string } | GeminiInlineDataPart;

export interface GeminiContent {
  readonly role?: "user" | "model" | undefined;
  readonly parts: ReadonlyArray<GeminiRequestPart>;
}

export interface GeminiGenerateContentRequest {
  readonly contents: ReadonlyArray<GeminiContent>;
  readonly systemInstruction?: { readonly parts: ReadonlyArray<{ readonly text: string }> };
  readonly generationConfig?: Record<string, unknown> | undefined;
}

export interface GeminiResponseText {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason?: string | undefined;
  readonly usage?: unknown;
}

export type GeminiSseDataLine =
  | { readonly type: "ignored"; readonly line: string }
  | { readonly type: "done" }
  | { readonly type: "json"; readonly data: string; readonly value: unknown }
  | { readonly type: "malformed"; readonly data: string };

export function normalizeGeminiModelPath(model: string): string {
  const trimmed = model.trim();
  const path =
    trimmed.startsWith("models/") || trimmed.startsWith("tunedModels/")
      ? trimmed
      : `models/${trimmed}`;
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function makeGeminiGenerateContentUrl(input: {
  readonly model: string;
  readonly stream: boolean;
}): string {
  const method = input.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `https://generativelanguage.googleapis.com/v1beta/${normalizeGeminiModelPath(input.model)}:${method}`;
}

export function buildGeminiGenerationConfig(input: {
  readonly thinkingConfig?: GeminiThinkingConfig | undefined;
  readonly responseSchema?: unknown;
}): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (input.thinkingConfig) {
    const thinkingConfig: Record<string, unknown> = {
      includeThoughts: input.thinkingConfig.includeThoughts,
    };
    if (input.thinkingConfig.thinkingBudget !== undefined) {
      thinkingConfig.thinkingBudget = input.thinkingConfig.thinkingBudget;
    }
    if (input.thinkingConfig.thinkingLevel !== undefined) {
      thinkingConfig.thinkingLevel = input.thinkingConfig.thinkingLevel;
    }
    config.thinkingConfig = thinkingConfig;
  }

  if (input.responseSchema !== undefined) {
    config.responseMimeType = "application/json";
    config.responseSchema = input.responseSchema;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

export function bytesToGeminiInlineDataPart(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): GeminiInlineDataPart {
  return {
    inline_data: {
      mime_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    },
  };
}

export function parseGeminiSseDataLine(line: string): GeminiSseDataLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return { type: "ignored", line };
  }

  const data = trimmed.slice("data:".length).trim();
  if (data === "[DONE]") {
    return { type: "done" };
  }

  try {
    return { type: "json", data, value: JSON.parse(data) as unknown };
  } catch {
    return { type: "malformed", data };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function responseParts(response: unknown): ReadonlyArray<Record<string, unknown>> {
  const root = asRecord(response);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const first = asRecord(candidates[0]);
  const content = asRecord(first?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.flatMap((part) => {
    const record = asRecord(part);
    return record ? [record] : [];
  });
}

export function geminiResponseToText(response: unknown): GeminiResponseText {
  let text = "";
  let reasoning = "";
  for (const part of responseParts(response)) {
    const partText = typeof part.text === "string" ? part.text : "";
    if (!partText) continue;
    if (part.thought === true) {
      reasoning += partText;
    } else {
      text += partText;
    }
  }

  const root = asRecord(response);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const first = asRecord(candidates[0]);
  const finishReason = typeof first?.finishReason === "string" ? first.finishReason : undefined;

  return {
    text,
    reasoning,
    ...(finishReason ? { finishReason } : {}),
    ...(root && "usageMetadata" in root ? { usage: root.usageMetadata } : {}),
  };
}

export function parseGeminiJsonText(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(unfenced) as unknown;
}

export async function readGeminiGenerateContentResponse(
  response: Response,
  emitAssistantDelta?: (delta: string) => Promise<void>,
  emitReasoningDelta?: (delta: string) => Promise<void>,
): Promise<GeminiResponseText> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const json = (await response.json()) as unknown;
    const result = geminiResponseToText(json);
    if (result.reasoning) await emitReasoningDelta?.(result.reasoning);
    if (result.text) await emitAssistantDelta?.(result.text);
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let finishReason: string | undefined;
  let usage: unknown;

  const handleValue = async (value: unknown): Promise<void> => {
    const delta = geminiResponseToText(value);
    if (delta.finishReason) finishReason = delta.finishReason;
    if (delta.usage !== undefined) usage = delta.usage;
    if (delta.reasoning) {
      reasoning += delta.reasoning;
      await emitReasoningDelta?.(delta.reasoning);
    }
    if (delta.text) {
      text += delta.text;
      await emitAssistantDelta?.(delta.text);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseGeminiSseDataLine(line);
        if (parsed.type === "done") {
          return {
            text,
            reasoning,
            ...(finishReason ? { finishReason } : {}),
            ...(usage !== undefined ? { usage } : {}),
          };
        }
        if (parsed.type === "json") {
          await handleValue(parsed.value);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim()) {
    const parsed = parseGeminiSseDataLine(buffer);
    if (parsed.type === "json") {
      await handleValue(parsed.value);
    }
  }

  return {
    text,
    reasoning,
    ...(finishReason ? { finishReason } : {}),
    ...(usage !== undefined ? { usage } : {}),
  };
}
