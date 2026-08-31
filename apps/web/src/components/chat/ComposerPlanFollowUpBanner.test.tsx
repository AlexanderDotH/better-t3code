import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";

describe("ComposerPlanFollowUpBanner", () => {
  it("localizes application copy while preserving the provider plan title", () => {
    const planTitle = "Migration plan / 移行計画";
    const markup = renderToStaticMarkup(<ComposerPlanFollowUpBanner planTitle={planTitle} />);

    expect(markup).toContain("Plan ready");
    expect(markup).toContain(planTitle);
  });
});
