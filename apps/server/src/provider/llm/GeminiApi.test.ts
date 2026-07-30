import { describe, expect, it } from "vite-plus/test";

import {
  buildGeminiGenerationConfig,
  geminiResponseToText,
  makeGeminiGenerateContentUrl,
  normalizeGeminiModelPath,
  parseGeminiJsonText,
  parseGeminiSseDataLine,
} from "./GeminiApi.ts";

describe("GeminiApi", () => {
  it("normalizes Gemini model paths for REST endpoints", () => {
    expect(normalizeGeminiModelPath("gemini-2.5-flash")).toBe("models/gemini-2.5-flash");
    expect(normalizeGeminiModelPath("models/gemini-2.5-flash")).toBe("models/gemini-2.5-flash");
    expect(makeGeminiGenerateContentUrl({ model: "gemini-2.5-flash", stream: true })).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
  });

  it("builds optional thinking and JSON response config", () => {
    expect(
      buildGeminiGenerationConfig({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 4096,
        },
        responseSchema: { type: "object" },
      }),
    ).toEqual({
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: 4096,
      },
      responseMimeType: "application/json",
      responseSchema: { type: "object" },
    });
  });

  it("parses Gemini SSE data lines", () => {
    const parsed = parseGeminiSseDataLine(
      'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}',
    );
    expect(parsed.type).toBe("json");
    expect(parseGeminiSseDataLine("event: message")).toEqual({
      type: "ignored",
      line: "event: message",
    });
    expect(parseGeminiSseDataLine("data: [DONE]")).toEqual({ type: "done" });
    expect(parseGeminiSseDataLine("data: {")).toEqual({ type: "malformed", data: "{" });
  });

  it("splits thought parts from assistant text", () => {
    expect(
      geminiResponseToText({
        candidates: [
          {
            content: {
              parts: [{ text: "thinking", thought: true }, { text: "answer" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { totalTokenCount: 12 },
      }),
    ).toEqual({
      text: "answer",
      reasoning: "thinking",
      finishReason: "STOP",
      usage: { totalTokenCount: 12 },
    });
  });

  it("parses fenced JSON text", () => {
    expect(parseGeminiJsonText('```json\n{"title":"Ship it"}\n```')).toEqual({
      title: "Ship it",
    });
  });
});
