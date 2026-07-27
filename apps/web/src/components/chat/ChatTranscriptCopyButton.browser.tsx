import { EnvironmentId, ThreadId, type EnvironmentApi } from "@t3tools/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { ChatTranscriptCopyButton } from "./ChatTranscriptCopyButton";

const environmentId = EnvironmentId.make("remote-transcript-environment");
const threadId = ThreadId.make("thread-transcript-copy");
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn(async () => undefined);

function environmentApi(
  exportThreadTranscript: EnvironmentApi["orchestration"]["exportThreadTranscript"],
): EnvironmentApi {
  return {
    orchestration: { exportThreadTranscript },
  } as unknown as EnvironmentApi;
}

describe("ChatTranscriptCopyButton", () => {
  beforeEach(() => {
    __resetEnvironmentApiOverridesForTests();
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("routes export through the scoped environment and copies only after it succeeds", async () => {
    const exportThreadTranscript = vi.fn(async () => ({
      formatVersion: 1 as const,
      fileName: "complete-thread.md",
      mediaType: "text/markdown" as const,
      generatedAt: "2026-07-12T12:00:00.000Z",
      content: "# Complete remote transcript",
    }));
    __setEnvironmentApiOverrideForTests(environmentId, environmentApi(exportThreadTranscript));
    render(
      <ChatTranscriptCopyButton
        environmentId={environmentId}
        threadId={threadId}
        activeTurnInProgress={false}
        environmentUnavailable={false}
      />,
    );

    await page.getByRole("button", { name: "Copy complete unredacted chat transcript" }).click();

    await expect
      .element(page.getByRole("button", { name: "Complete transcript copied" }))
      .toBeVisible();
    expect(exportThreadTranscript).toHaveBeenCalledOnce();
    expect(exportThreadTranscript).toHaveBeenCalledWith({ threadId });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("# Complete remote transcript");
  });

  it("leaves the clipboard untouched when export fails", async () => {
    const exportThreadTranscript = vi.fn(async () => {
      throw new Error("Thread no longer exists");
    });
    __setEnvironmentApiOverrideForTests(environmentId, environmentApi(exportThreadTranscript));
    render(
      <ChatTranscriptCopyButton
        environmentId={environmentId}
        threadId={threadId}
        activeTurnInProgress={false}
        environmentUnavailable={false}
      />,
    );
    const button = page.getByRole("button", {
      name: "Copy complete unredacted chat transcript",
    });

    await button.click();

    await expect.element(button).toBeEnabled();
    expect(exportThreadTranscript).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("deduplicates repeated clicks while an export is loading", async () => {
    let resolveExport!: (value: {
      formatVersion: 1;
      fileName: string;
      mediaType: "text/markdown";
      generatedAt: string;
      content: string;
    }) => void;
    const pendingExport = new Promise<Parameters<typeof resolveExport>[0]>((resolve) => {
      resolveExport = resolve;
    });
    const exportThreadTranscript = vi.fn(() => pendingExport);
    __setEnvironmentApiOverrideForTests(environmentId, environmentApi(exportThreadTranscript));
    render(
      <ChatTranscriptCopyButton
        environmentId={environmentId}
        threadId={threadId}
        activeTurnInProgress={false}
        environmentUnavailable={false}
      />,
    );
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLButtonElement>(
          'button[aria-label="Copy complete unredacted chat transcript"]',
        ),
      ).not.toBeNull();
    });
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy complete unredacted chat transcript"]',
    );
    if (!button) throw new Error("Transcript copy button was not rendered.");

    button.click();
    button.click();
    expect(exportThreadTranscript).toHaveBeenCalledOnce();
    resolveExport({
      formatVersion: 1,
      fileName: "deduplicated.md",
      mediaType: "text/markdown",
      generatedAt: "2026-07-12T12:00:00.000Z",
      content: "deduplicated",
    });

    await expect
      .element(page.getByRole("button", { name: "Complete transcript copied" }))
      .toBeVisible();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("is disabled while a turn is active", async () => {
    const exportThreadTranscript = vi.fn();
    __setEnvironmentApiOverrideForTests(
      environmentId,
      environmentApi(exportThreadTranscript as never),
    );
    render(
      <ChatTranscriptCopyButton
        environmentId={environmentId}
        threadId={threadId}
        activeTurnInProgress
        environmentUnavailable={false}
      />,
    );

    await expect
      .element(
        page.getByRole("button", {
          name: "Wait for the active turn to finish before exporting.",
        }),
      )
      .toBeDisabled();
    expect(exportThreadTranscript).not.toHaveBeenCalled();
  });

  it("is disabled while the thread environment is unavailable", async () => {
    const exportThreadTranscript = vi.fn();
    __setEnvironmentApiOverrideForTests(
      environmentId,
      environmentApi(exportThreadTranscript as never),
    );
    render(
      <ChatTranscriptCopyButton
        environmentId={environmentId}
        threadId={threadId}
        activeTurnInProgress={false}
        environmentUnavailable
      />,
    );

    await expect
      .element(
        page.getByRole("button", {
          name: "Reconnect the thread environment before exporting.",
        }),
      )
      .toBeDisabled();
    expect(exportThreadTranscript).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
