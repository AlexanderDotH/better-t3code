import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME,
  SubagentTranscriptDialogContent,
} from "./SubagentTranscriptDialog";

describe("SubagentTranscriptDialog", () => {
  it("renders transcript states inside a centered modal surface", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptDialogContent subagent={null} isLoading />,
    );

    expect(html).toContain('data-subagent-transcript-dialog="true"');
    expect(html).toContain("Loading agent transcript");
    expect(SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME).toContain("max-w-[min(64rem,calc(100vw-2rem))]");
    expect(SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME).toContain("h-[min(82vh,52rem)]");
  });
});
