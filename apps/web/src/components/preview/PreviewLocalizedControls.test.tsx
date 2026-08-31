import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("~/previewStateStore", () => ({ isPreviewSupportedInRuntime: () => false }));
vi.mock("./PreviewFaviconIcon", () => ({
  PreviewFaviconIcon: () => <span data-favicon-icon />,
}));
vi.mock("./PreviewView", () => ({ PreviewView: () => null }));

import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { PreviewPanel } from "./PreviewPanel";
import { PreviewRecentUrlCard } from "./PreviewRecentUrlCard";
import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

const environmentId = EnvironmentId.make("environment-localized-preview");
const threadRef = { environmentId, threadId: ThreadId.make("thread-localized-preview") };

describe("localized preview controls", () => {
  it("localizes fallback server status while preserving the host and port", () => {
    const html = renderToStaticMarkup(
      <PreviewLocalServerCard
        threadRef={threadRef}
        server={{
          host: "localhost",
          port: 5173,
          url: "http://localhost:5173",
          requestedUrl: "http://localhost:5173",
          processName: null,
          pid: null,
          terminal: null,
          source: "scanner",
        }}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain("En écoute");
    expect(html).toContain("localhost:5173");
    expect(html).not.toContain("Listening");
  });

  it("localizes the history removal label without translating the URL", () => {
    const html = renderToStaticMarkup(
      <PreviewRecentUrlCard
        threadRef={threadRef}
        entry={{ url: "https://preview.example.test/path", lastVisitedAt: 0 }}
        onOpen={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(html).toContain("Retirer preview.example.test/path de l’historique");
    expect(html).toContain("preview.example.test/path");
    expect(html).not.toContain("Remove preview.example.test/path from history");
  });

  it("localizes the unsupported-runtime message and resize separator", () => {
    const panel = renderToStaticMarkup(
      <PreviewPanel mode="inline" threadRef={threadRef} visible={true} />,
    );
    const separator = renderToStaticMarkup(<RightPanelResizeHandle handlers={{} as never} />);

    expect(panel).toContain(
      "L’aperçu est disponible uniquement dans l’application de bureau T3 Code.",
    );
    expect(separator).toContain('aria-label="Redimensionner le panneau d’aperçu"');
  });
});
