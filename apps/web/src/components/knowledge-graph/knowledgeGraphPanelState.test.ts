import { describe, expect, it } from "vite-plus/test";

import { resolveKnowledgeGraphLoadState } from "./knowledgeGraphPanelState";

describe("resolveKnowledgeGraphLoadState", () => {
  it("distinguishes a failed subscription from an empty in-flight snapshot", () => {
    expect(resolveKnowledgeGraphLoadState("Failure", false)).toBe("error");
    expect(resolveKnowledgeGraphLoadState("Initial", false)).toBe("loading");
    expect(resolveKnowledgeGraphLoadState("Success", true)).toBe("ready");
  });
});
