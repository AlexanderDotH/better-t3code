import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import {
  composerActivityMessageId,
  composerActivityVariant,
  formatWorkingTimer,
  resolveComposerActivityTokenUsage,
} from "./ComposerActivityStatus";

describe("composer activity status", () => {
  it("distinguishes synchronization from active work in the selected interface language", () => {
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" }).message;
    expect(german(composerActivityMessageId({ kind: "sync", phase: "loading" }))).toBe(
      "Nachrichten werden geladen...",
    );
    expect(french(composerActivityMessageId({ kind: "sync", phase: "syncing" }))).toBe(
      "Synchronisation des messages...",
    );
    expect(german(composerActivityMessageId({ kind: "working", startedAt: null }))).toBe(
      "Arbeitet...",
    );
    expect(french(composerActivityMessageId({ kind: "working", startedAt: "2026-08-30" }))).toBe(
      "Travaille depuis",
    );
    expect(composerActivityVariant({ kind: "sync", phase: "loading" })).toBe("info");
    expect(composerActivityVariant({ kind: "working", startedAt: null })).toBe("activity");
  });

  it("ignores stale token usage from the previous turn", () => {
    const snapshot = {
      updatedAt: "2026-08-30T12:00:04Z",
      inputTokens: 1200,
      lastInputTokens: 1100,
      outputTokens: 80,
      lastOutputTokens: 75,
    };
    expect(
      resolveComposerActivityTokenUsage({ activeWorkStartedAt: "2026-08-30T12:00:00Z", snapshot }),
    ).toEqual({ inputTokens: 1100, outputTokens: 75 });
    expect(
      resolveComposerActivityTokenUsage({ activeWorkStartedAt: "2026-08-30T12:00:05Z", snapshot }),
    ).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("falls back to cumulative token fields when the provider has no last-turn usage", () => {
    expect(
      resolveComposerActivityTokenUsage({
        activeWorkStartedAt: "2026-08-30T12:00:00Z",
        snapshot: {
          updatedAt: "2026-08-30T12:00:00Z",
          inputTokens: 200,
          outputTokens: 45,
          lastInputTokens: null,
          lastOutputTokens: null,
        },
      }),
    ).toEqual({ inputTokens: 200, outputTokens: 45 });
  });

  it.each([null, "invalid timestamp"])(
    "avoids misleading token counts when work start is %s",
    (activeWorkStartedAt) => {
      expect(
        resolveComposerActivityTokenUsage({
          activeWorkStartedAt,
          snapshot: {
            updatedAt: "2026-08-30T12:00:00Z",
            inputTokens: 200,
            outputTokens: 45,
            lastInputTokens: 100,
            lastOutputTokens: 25,
          },
        }),
      ).toEqual({ inputTokens: 0, outputTokens: 0 });
    },
  );

  it.each([
    ["2026-08-30T12:00:08Z", "8s"],
    ["2026-08-30T12:01:00Z", "1m"],
    ["2026-08-30T12:01:15Z", "1m 15s"],
    ["2026-08-30T13:00:00Z", "1h"],
    ["2026-08-30T13:02:00Z", "1h 2m"],
    ["2026-08-30T11:59:00Z", "0s"],
  ])("formats elapsed work at %s without negative durations", (end, expected) => {
    expect(formatWorkingTimer("2026-08-30T12:00:00Z", end)).toBe(expected);
  });

  it("rejects invalid timer timestamps", () => {
    expect(formatWorkingTimer("broken", "2026-08-30T12:00:00Z")).toBeNull();
    expect(formatWorkingTimer("2026-08-30T12:00:00Z", "broken")).toBeNull();
  });
});
