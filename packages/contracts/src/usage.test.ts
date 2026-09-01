import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { UsageBucket } from "./usage.ts";

const decodeBucket = Schema.decodeUnknownSync(UsageBucket);

const bucket = {
  day: "2026-08-31",
  provider: "codex",
  model: "gpt-5.6-sol",
  totals: {
    uncachedInputTokens: 10,
    cachedInputTokens: 20,
    cacheCreationTokens: 0,
    outputTokens: 5,
    reasoningTokens: 2,
  },
  costUsd: 0,
  cacheSavingsUsd: 0,
  costSource: "unpriced",
  records: 1,
  unpricedRecords: 1,
  sessions: 1,
} as const;

describe("UsageBucket", () => {
  it("decodes older buckets without attribution or diagnostics", () => {
    expect(decodeBucket(bucket)).toMatchObject(bucket);
  });

  it("decodes bounded call attribution and context diagnostics", () => {
    expect(
      decodeBucket({
        ...bucket,
        callKind: "subagent",
        diagnostics: {
          nativeForks: 1,
          compactHandoffs: 2,
          totalHandoffChars: 4_096,
          compactionEvents: 3,
          maxContextTokens: 200_000,
        },
      }),
    ).toMatchObject({
      callKind: "subagent",
      diagnostics: { nativeForks: 1, totalHandoffChars: 4_096 },
    });
  });

  it("separates Auto Reasoning calls and content-free token-saving diagnostics", () => {
    expect(
      decodeBucket({
        ...bucket,
        callKind: "auto-reasoning",
        diagnostics: {
          nativeForks: 0,
          compactHandoffs: 0,
          totalHandoffChars: 0,
          compactionEvents: 0,
          maxContextTokens: 200_000,
          instructionChars: 8_000,
          memoryInjectionChars: 0,
          toolSchemaChars: 4_000,
          subagentResultChars: 1_000,
          toolDigestChars: 512,
          autoRoutingChars: 2_000,
        },
      }),
    ).toMatchObject({
      callKind: "auto-reasoning",
      diagnostics: {
        instructionChars: 8_000,
        memoryInjectionChars: 0,
        toolSchemaChars: 4_000,
        subagentResultChars: 1_000,
        toolDigestChars: 512,
        autoRoutingChars: 2_000,
      },
    });
  });

  it("does not decode content fields in diagnostics", () => {
    const decoded = decodeBucket({
      ...bucket,
      diagnostics: {
        nativeForks: 0,
        compactHandoffs: 0,
        totalHandoffChars: 0,
        compactionEvents: 0,
        maxContextTokens: 0,
        prompt: "must not cross the wire",
      },
    });

    expect(decoded.diagnostics).not.toHaveProperty("prompt");
  });

  it("rejects negative diagnostic counters", () => {
    expect(() =>
      decodeBucket({
        ...bucket,
        diagnostics: {
          nativeForks: -1,
          compactHandoffs: 0,
          totalHandoffChars: 0,
          compactionEvents: 0,
          maxContextTokens: 0,
        },
      }),
    ).toThrow();
  });
});
