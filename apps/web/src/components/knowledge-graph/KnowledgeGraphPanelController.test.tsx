import type {
  KnowledgeGraphQueryOperationResultV1,
  KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  applyKnowledgeGraphQueryResult,
  KnowledgeGraphDisabledOwnerView,
  resolveKnowledgeGraphPanelMode,
} from "./KnowledgeGraphPanelController";

describe("resolveKnowledgeGraphPanelMode", () => {
  it("keeps mixed-version clients unsupported and retained data clearable while disabled", () => {
    expect(
      resolveKnowledgeGraphPanelMode({ knowledgeGraphVersion: undefined, enabled: false }),
    ).toBe("unsupported");
    expect(resolveKnowledgeGraphPanelMode({ knowledgeGraphVersion: 0, enabled: true })).toBe(
      "unsupported",
    );
    expect(resolveKnowledgeGraphPanelMode({ knowledgeGraphVersion: 1, enabled: false })).toBe(
      "disabled-owner",
    );
    expect(resolveKnowledgeGraphPanelMode({ knowledgeGraphVersion: 1, enabled: true })).toBe(
      "connected",
    );
  });
});

describe("KnowledgeGraphDisabledOwnerView", () => {
  it("offers only confirmed data clearing without activating graph work", () => {
    const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
    const markup = renderToStaticMarkup(
      <KnowledgeGraphDisabledOwnerView translate={translate} onClear={() => undefined} />,
    );

    expect(markup).toContain("Enable the Knowledge Graph in Better T3 settings.");
    expect(markup).toContain("Clear graph");
    expect(markup).not.toContain("Rebuild");
    expect(markup).not.toContain("Pause indexing");
    expect(markup).not.toContain("Cancel indexing");
  });
});

describe("applyKnowledgeGraphQueryResult", () => {
  it("uses the connected server overview instead of the alphabetical snapshot prefix", () => {
    const snapshot = {
      revision: 1,
      nodes: [{ nodeId: "isolated-dependency" }],
      edges: [],
      evidence: [],
      status: { truncated: { visibleNodes: false } },
    } as unknown as KnowledgeGraphSnapshotV1;
    const overview = {
      id: "web-overview",
      type: "overview",
      nodes: [{ nodeId: "repository" }, { nodeId: "package" }],
      edges: [{ edgeId: "contains" }],
      evidence: [],
      truncated: true,
    } as unknown as KnowledgeGraphQueryOperationResultV1;

    const displayed = applyKnowledgeGraphQueryResult(snapshot, overview, 2);

    expect(displayed?.revision).toBe(2);
    expect(displayed?.nodes.map(({ nodeId }) => nodeId)).toEqual(["repository", "package"]);
    expect(displayed?.edges.map(({ edgeId }) => edgeId)).toEqual(["contains"]);
    expect(displayed?.status.truncated.visibleNodes).toBe(true);
  });
});
