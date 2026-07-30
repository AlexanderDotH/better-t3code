import { describe, expect, it } from "vite-plus/test";

import {
  OPENROUTER_BODY_POLICY,
  STRICT_OPENAI_BODY_POLICY,
  applyOpenAiCompletionBodyPolicies,
  applyOpenRouterUnifiedReasoning,
  extractOpenAiTextContent,
  extractOpenRouterReasoningPayload,
  isAnthropicOpenRouterModelId,
  mergeOpenRouterContextCompressionPlugin,
  parseOpenAiSseDataLine,
  toOpenAiMessages,
} from "./OpenAiCompatibleChat.ts";

describe("OpenAI-compatible body policy", () => {
  it("does not attach OpenRouter fields under strict policy", () => {
    const body: Record<string, unknown> = {
      model: "meta/llama-3.1-8b-instruct",
      messages: [],
      stream: false,
    };

    const snapshot = applyOpenAiCompletionBodyPolicies({
      body,
      bodyPolicy: STRICT_OPENAI_BODY_POLICY,
      contextCompressionEnabled: true,
      reasoning: {
        storedModelId: "nvidia:meta/llama-3.1-8b-instruct",
        effort: "high",
      },
    });

    expect(snapshot).toEqual({
      provider: "openrouter",
      reasoningAttached: false,
      mode: "none",
    });
    expect(body.plugins).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("merges context compression once when OpenRouter policy allows it", () => {
    const body: Record<string, unknown> = {
      model: "anthropic/claude-3.5-sonnet",
      messages: [],
      stream: false,
      plugins: [{ id: "web" }],
    };

    applyOpenAiCompletionBodyPolicies({
      body,
      bodyPolicy: OPENROUTER_BODY_POLICY,
      contextCompressionEnabled: true,
      reasoning: {
        storedModelId: "anthropic/claude-3.5-sonnet",
        effort: "medium",
      },
    });
    applyOpenAiCompletionBodyPolicies({
      body,
      bodyPolicy: OPENROUTER_BODY_POLICY,
      contextCompressionEnabled: true,
      reasoning: {
        storedModelId: "anthropic/claude-3.5-sonnet",
        effort: "medium",
      },
    });

    expect(body.plugins).toEqual([{ id: "web" }, { id: "context-compression" }]);
  });

  it("replaces malformed plugin payloads with a context compression plugin", () => {
    const body: Record<string, unknown> = { plugins: "bad" };

    mergeOpenRouterContextCompressionPlugin(body, true);

    expect(body.plugins).toEqual([{ id: "context-compression" }]);
  });
});

describe("OpenRouter reasoning mapping", () => {
  it("detects Anthropic OpenRouter model ids", () => {
    expect(isAnthropicOpenRouterModelId(" anthropic/claude-sonnet-4 ")).toBe(true);
    expect(isAnthropicOpenRouterModelId("openai/gpt-5")).toBe(false);
  });

  it("uses effort for non-Anthropic models", () => {
    const body: Record<string, unknown> = { model: "openai/gpt-5", messages: [] };

    const result = applyOpenRouterUnifiedReasoning(body, "openai/gpt-5", "high");

    expect(result).toEqual({ attached: true, mode: "effort", effort: "high" });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.max_tokens).toBeUndefined();
  });

  it("uses reasoning max_tokens plus top-level max_tokens for Anthropic models", () => {
    const body: Record<string, unknown> = { model: "anthropic/claude-sonnet-4", messages: [] };

    const result = applyOpenRouterUnifiedReasoning(body, "anthropic/claude-sonnet-4", "medium");

    expect(result).toEqual({
      attached: true,
      mode: "max_tokens",
      maxTokens: 8192,
      completionMaxTokens: 73728,
    });
    expect(body.reasoning).toEqual({ max_tokens: 8192 });
    expect(body.max_tokens).toBe(73728);
  });
});

describe("OpenAI-compatible message mapping", () => {
  it("keeps single text messages as string content", () => {
    const messages = toOpenAiMessages("System prompt", [
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi" }] },
    ]);

    expect(messages).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  });

  it("serializes image inline data as image_url content parts", () => {
    const messages = toOpenAiMessages("", [
      {
        role: "user",
        parts: [
          { text: "Inspect this UI." },
          {
            inlineData: {
              mimeType: "image/png",
              data: "iVBORw0KGgo=",
              filename: "screen.png",
            },
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this UI." },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
  });

  it("serializes PDF inline data as an OpenRouter file content part", () => {
    const messages = toOpenAiMessages("", [
      {
        role: "user",
        parts: [
          { text: "Analyze this contract." },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: "JVBERi0x",
              filename: "contract.pdf",
            },
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this contract." },
          {
            type: "file",
            file: {
              filename: "contract.pdf",
              file_data: "data:application/pdf;base64,JVBERi0x",
            },
          },
        ],
      },
    ]);
  });
});

describe("OpenAI-compatible SSE parsing", () => {
  it("parses JSON data lines", () => {
    expect(parseOpenAiSseDataLine('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({
      type: "json",
      data: '{"choices":[{"delta":{"content":"hi"}}]}',
      value: { choices: [{ delta: { content: "hi" } }] },
    });
  });

  it("detects done, malformed, and ignored lines", () => {
    expect(parseOpenAiSseDataLine("data: [DONE]")).toEqual({ type: "done" });
    expect(parseOpenAiSseDataLine("data: {")).toEqual({ type: "malformed", data: "{" });
    expect(parseOpenAiSseDataLine("event: message")).toEqual({
      type: "ignored",
      line: "event: message",
    });
  });
});

describe("OpenAI-compatible response content extraction", () => {
  it("joins text content parts from streamed or non-streamed payloads", () => {
    expect(extractOpenAiTextContent(["a", { text: "b" }, { ignored: "c" }])).toBe("ab");
  });

  it("extracts OpenRouter reasoning from known payload shapes", () => {
    expect(extractOpenRouterReasoningPayload({ reasoning: "direct" })).toBe("direct");
    expect(extractOpenRouterReasoningPayload({ reasoning_content: "compat" })).toBe("compat");
    expect(extractOpenRouterReasoningPayload({ reasoning_details: [{ text: "a" }, "b"] })).toBe(
      "ab",
    );
    expect(
      extractOpenRouterReasoningPayload({
        content: [
          { type: "reasoning", text: "first" },
          { type: "text", text: "visible" },
          { type: "reasoning", text: "second" },
        ],
      }),
    ).toBe("first\nsecond");
  });
});
