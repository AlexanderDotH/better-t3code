import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

// Deliberate integration-policy coverage: this verifies which policy field owns
// launch affordances versus an already-open surface without mounting ChatView's
// environment-wide state graph.
describe("ChatView knowledge graph surface policy wiring", () => {
  it("keeps an existing owner mounted when feature-off only disables new launches", () => {
    const contentStart = chatViewSource.indexOf("const rightPanelContent = activeThreadRef ? (");
    const contentEnd = chatViewSource.indexOf(
      ': activeRightPanelSurface?.kind === "diff"',
      contentStart,
    );
    const knowledgeGraphOwnerSource = chatViewSource.slice(contentStart, contentEnd);

    expect(chatViewSource).toContain(
      "const knowledgeGraphAvailable = knowledgeGraphSurfacePolicy.launchAvailable;",
    );
    expect(chatViewSource).toContain("knowledgeGraphSurfacePolicy.closeExisting");
    expect(knowledgeGraphOwnerSource).toContain(
      'activeRightPanelSurface?.kind === "knowledge-graph" && activeProject',
    );
    expect(knowledgeGraphOwnerSource).toContain("<KnowledgeGraphPanelController");
    expect(knowledgeGraphOwnerSource).not.toContain("knowledgeGraphAvailable");
  });

  it("gates both launch entry points and the open callback on launch availability", () => {
    expect(chatViewSource).toContain("if (!activeThreadRef || !knowledgeGraphAvailable) return;");
    expect(chatViewSource.match(/\.\.\.\(knowledgeGraphAvailable/g)).toHaveLength(2);
    expect(chatViewSource.match(/onAddKnowledgeGraph: addKnowledgeGraphSurface/g)).toHaveLength(2);
  });
});
