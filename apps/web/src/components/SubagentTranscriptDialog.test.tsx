import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import dialogSource from "./SubagentTranscriptDialog.tsx?raw";
import {
  SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME,
  SubagentTranscriptDialogContent,
} from "./SubagentTranscriptDialog";

describe("SubagentTranscriptDialog", () => {
  it("renders transcript states inside a centered viewport-safe modal surface", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptDialogContent subagent={null} isLoading />,
    );

    expect(html).toContain('data-subagent-transcript-dialog="true"');
    expect(html).toContain("Loading agent transcript");
    expect(SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME).toContain("max-w-[min(64rem,calc(100dvw-2rem))]");
    expect(SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME).toContain("h-[min(82dvh,52rem)]");
  });

  it("retains Base UI focus/escape behavior, a visible close button, and no mobile bottom sheet", () => {
    expect(dialogSource).toContain("<Dialog open={open} onOpenChange={onOpenChange}>");
    expect(dialogSource).toContain("bottomStickOnMobile={false}");
    expect(dialogSource).not.toContain("showCloseButton={false}");
  });
});
