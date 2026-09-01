import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
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
