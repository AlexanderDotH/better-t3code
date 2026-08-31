import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { pseudoLocalizeInterfaceMessage } from "@t3tools/shared/interfaceLanguage";

const translatorFixture = vi.hoisted(() => ({ pseudo: false }));

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator, pseudoLocalizeInterfaceMessage } =
    await import("@t3tools/shared/interfaceLanguage");
  const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });
  return {
    useInterfaceTranslator: () =>
      translatorFixture.pseudo ? { ...french, message: pseudoLocalizeInterfaceMessage } : french,
  };
});

import { SidebarOlderProjectsSection } from "./SidebarOlderProjectsSection";

describe("SidebarOlderProjectsSection localization", () => {
  afterEach(() => {
    translatorFixture.pseudo = false;
  });

  it("renders the visible label, tooltip, and plural accessibility copy in French", () => {
    const html = renderToStaticMarkup(
      <SidebarOlderProjectsSection count={2} open={false} onOpenChange={() => {}}>
        <span>Project content</span>
      </SidebarOlderProjectsSection>,
    );

    expect(html).toContain("Projets plus anciens");
    expect(html).toContain("Aucune activité de travail depuis plus de 7 jours.");
    expect(html).toContain('aria-label="2 projets plus anciens"');
    expect(html).not.toContain("Project content");
  });

  it("bounds long pseudo-localized labels without dropping plural accessibility copy", () => {
    translatorFixture.pseudo = true;
    const html = renderToStaticMarkup(
      <SidebarOlderProjectsSection count={12} open={false} onOpenChange={() => {}}>
        <span>Project content</span>
      </SidebarOlderProjectsSection>,
    );

    expect(html).toContain(pseudoLocalizeInterfaceMessage("sidebar.olderProjects.label"));
    expect(html).toContain(
      `aria-label="${pseudoLocalizeInterfaceMessage("sidebar.olderProjects.count", { count: 12 })}"`,
    );
    expect(html).toContain('class="min-w-0 flex-1 truncate"');
    expect(html).toContain('class="tabular-nums"');
  });
});
