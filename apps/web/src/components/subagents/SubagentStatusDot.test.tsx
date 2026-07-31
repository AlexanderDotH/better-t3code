import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { SubagentStatusPresentation } from "./subagentPresentation";
import { SubagentStatusDot } from "./SubagentStatusDot";

const WORKING_PRESENTATION: SubagentStatusPresentation = {
  label: "Running",
  activity: "Reviewing changes",
  detail: null,
  tone: "progress",
  isActive: true,
};

describe("SubagentStatusDot", () => {
  it("uses a static working indicator without a continuous repaint animation", () => {
    const html = renderToStaticMarkup(
      <SubagentStatusDot presentation={WORKING_PRESENTATION} tone="working" />,
    );

    expect(html).toContain("bg-sky-500");
    expect(html).not.toContain("animate-pulse");
  });
});
