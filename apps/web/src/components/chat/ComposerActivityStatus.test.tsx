import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () =>
    createInterfaceTranslator({
      language: "en",
      locale: "en-US",
    }),
}));

import {
  ComposerActivityBanner,
  ComposerActivityLabel,
  ComposerActivityRow,
  composerActivityMessageId,
  composerActivityVariant,
  resolveComposerActivityTokenUsage,
} from "./ComposerActivityStatus";
import { ComposerBanner } from "./ComposerBanner";

describe("ComposerActivityStatus", () => {
  it("maps every activity state to typed localized copy", () => {
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
  });

  it("renders the localized application label without changing activity data", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityLabel status={{ kind: "sync", phase: "loading" }} />,
    );

    expect(markup).toContain('data-composer-sync-status="loading"');
    expect(markup).toContain("Loading messages...");
  });

  it("keeps sync blue while active work uses its own activity treatment", () => {
    expect(composerActivityVariant({ kind: "sync", phase: "loading" })).toBe("info");
    expect(composerActivityVariant({ kind: "working", startedAt: null })).toBe("activity");
  });

  it("uses only a token snapshot emitted during the active turn", () => {
    const snapshot = {
      updatedAt: "2026-08-30T12:00:04.000Z",
      inputTokens: 1_200,
      lastInputTokens: 1_100,
      outputTokens: 80,
      lastOutputTokens: 75,
    };

    expect(
      resolveComposerActivityTokenUsage({
        activeWorkStartedAt: "2026-08-30T12:00:00.000Z",
        snapshot,
      }),
    ).toEqual({ inputTokens: 1_100, outputTokens: 75 });
    expect(
      resolveComposerActivityTokenUsage({
        activeWorkStartedAt: "2026-08-30T12:00:05.000Z",
        snapshot,
      }),
    ).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("uses prompt and agent icons for input and output tokens", () => {
    const status = {
      kind: "working" as const,
      startedAt: null,
      inputTokens: 1_200,
      outputTokens: 75,
    };
    const markup = renderToStaticMarkup(
      <ComposerBanner.FloatingGroup>
        <ComposerBanner.Dock>
          <ComposerActivityBanner status={status} />
        </ComposerBanner.Dock>
      </ComposerBanner.FloatingGroup>,
    );

    expect(markup).toContain('data-chat-composer-activity-strip="true"');
    expect(markup).toContain('data-composer-banner-width="fill"');
    expect(markup).toContain('data-variant="activity"');
    expect(markup).toContain('data-composer-token-direction="input"');
    expect(markup).toContain('data-composer-token-direction="output"');
    expect(markup).toContain("lucide-message-square");
    expect(markup).toContain("lucide-bot");
    expect(markup).toContain("1.2k");
    expect(markup).toContain("75");
    expect(markup).toContain("Input");
    expect(markup).toContain("Output");
  });

  it("keeps token metrics inside the normal activity row", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityRow
        status={{
          kind: "working",
          startedAt: null,
          inputTokens: 500,
          outputTokens: 25,
        }}
      />,
    );

    expect(markup.match(/data-composer-token-direction=/g)).toHaveLength(2);
  });
});
