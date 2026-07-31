import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";

function TranscriptDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open agent transcript
      </button>
      <button type="button">Outside action</button>
      <SubagentTranscriptDialog open={open} onOpenChange={setOpen} subagent={null} isLoading />
    </div>
  );
}

function transcriptPopup(): HTMLElement {
  const popup = document.querySelector<HTMLElement>(
    '[data-slot="dialog-popup"][data-subagent-transcript-dialog="true"]',
  );
  if (!popup) {
    throw new Error("Agent transcript dialog was not rendered.");
  }
  return popup;
}

describe("SubagentTranscriptDialog keyboard behavior", () => {
  it("traps focus, closes on Escape, and restores focus to its trigger", async () => {
    render(<TranscriptDialogHarness />);
    const trigger = page.getByRole("button", { name: "Open agent transcript" });

    await trigger.click();
    await expect.element(page.getByRole("dialog", { name: "Agent transcript" })).toBeVisible();

    const popup = transcriptPopup();
    expect(popup.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Tab}");
    expect(popup.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("dialog", { name: "Agent transcript" }))
      .not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Open agent transcript");
    });
  });
});
