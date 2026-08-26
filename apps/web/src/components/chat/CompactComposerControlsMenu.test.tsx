import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import compactComposerControlsMenuSource from "./CompactComposerControlsMenu.tsx?raw";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

const renderMenu = (contextWindowMenuContent?: ReactNode) =>
  renderToStaticMarkup(
    <CompactComposerControlsMenu
      contextWindowMenuContent={contextWindowMenuContent}
      interactionMode="default"
      onInteractionModeChange={() => undefined}
      onRuntimeModeChange={() => undefined}
      runtimeMode="approval-required"
      showInteractionModeSelect
      traitsMenuContent={<div data-test-composer-traits="true">Reasoning</div>}
    />,
  );

describe("CompactComposerControlsMenu", () => {
  it("server-renders the accessible ellipsis trigger", () => {
    const markup = renderMenu(<div data-chat-context-window-menu-content="true">Context</div>);

    expect(markup).toContain('aria-label="More composer controls"');
    expect(markup).toContain('data-slot="menu-trigger"');
  });

  it("renders one inline popup ordered as traits, context, Mode, then Access", () => {
    const popupStart = compactComposerControlsMenuSource.indexOf("<MenuPopup");
    const popupSource = compactComposerControlsMenuSource.slice(popupStart);
    const traitsIndex = popupSource.indexOf("{props.traitsMenuContent}");
    const contextIndex = popupSource.indexOf("{props.contextWindowMenuContent}");
    const modeIndex = popupSource.indexOf(">Mode</div>");
    const accessIndex = popupSource.indexOf(">Access</div>");

    expect(popupStart).toBeGreaterThanOrEqual(0);
    expect(compactComposerControlsMenuSource.match(/<MenuPopup/g)).toHaveLength(1);
    expect(popupSource.match(/<MenuDivider \/>/g)).toHaveLength(3);
    expect(traitsIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(traitsIndex);
    expect(modeIndex).toBeGreaterThan(contextIndex);
    expect(accessIndex).toBeGreaterThan(modeIndex);
  });

  it("widens only the popup that contains the context slider", () => {
    expect(compactComposerControlsMenuSource).toContain(
      'props.contextWindowMenuContent ? "w-72 max-w-[calc(100vw-1.5rem)]" : undefined',
    );
  });

  it("keeps inline slider pointer and navigation-key events inside its section", () => {
    expect(compactComposerControlsMenuSource).toContain(
      "onPointerDown={stopMenuInteractionPropagation}",
    );
    expect(compactComposerControlsMenuSource).toContain("onClick={stopMenuInteractionPropagation}");
    expect(compactComposerControlsMenuSource).toContain(
      "onKeyDown={stopMenuNavigationKeyPropagation}",
    );
  });

  it("keeps the compact popup at its existing width without context content", () => {
    expect(renderMenu()).not.toContain("w-72");
  });
});
