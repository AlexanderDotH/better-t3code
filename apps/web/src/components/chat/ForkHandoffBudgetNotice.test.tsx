import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ForkHandoffBudgetNotice } from "./ForkHandoffBudgetNotice";

describe("ForkHandoffBudgetNotice", () => {
  it("explains that inherited context adapts to the ordinary first-turn limits", () => {
    const markup = renderToStaticMarkup(
      <ForkHandoffBudgetNotice
        budget={{ remainingInputChars: 12_345, remainingAttachmentCount: 2 }}
      />,
    );

    expect(markup).toContain("12,345 characters");
    expect(markup).toContain("2 attachments");
    expect(markup).toContain("Inherited context adapts");
    expect(markup).toContain('data-fork-handoff-budget="true"');
  });

  it("renders nothing after the one-time handoff completes", () => {
    expect(renderToStaticMarkup(<ForkHandoffBudgetNotice budget={null} />)).toBe("");
  });
});
