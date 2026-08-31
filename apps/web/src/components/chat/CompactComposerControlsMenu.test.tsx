import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  compactComposerMenuSectionIds,
  compactComposerPopupClassName,
  CompactComposerControlsMenu,
  stopCompactComposerMenuInteractionPropagation,
  stopCompactComposerMenuNavigationKeyPropagation,
} from "./CompactComposerControlsMenu";

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

  it("orders traits, context, interaction mode, and runtime mode in one section model", () => {
    expect(
      compactComposerMenuSectionIds({
        hasTraits: true,
        hasContextWindow: true,
        showInteractionMode: true,
      }),
    ).toEqual(["traits", "context-window", "interaction-mode", "runtime-mode"]);

    expect(
      compactComposerMenuSectionIds({
        hasTraits: false,
        hasContextWindow: false,
        showInteractionMode: false,
      }),
    ).toEqual(["runtime-mode"]);
  });

  it("widens only the popup that contains the context slider", () => {
    expect(compactComposerPopupClassName(true)).toBe("w-72 max-w-[calc(100vw-1.5rem)]");
    expect(compactComposerPopupClassName(false)).toBeUndefined();
  });

  it("keeps inline slider pointer and navigation-key events inside its section", () => {
    const pointerStop = vi.fn();
    const clickStop = vi.fn();
    stopCompactComposerMenuInteractionPropagation({ stopPropagation: pointerStop });
    stopCompactComposerMenuInteractionPropagation({ stopPropagation: clickStop });
    expect(pointerStop).toHaveBeenCalledOnce();
    expect(clickStop).toHaveBeenCalledOnce();

    for (const key of [
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "End",
      "Home",
      "PageDown",
      "PageUp",
    ]) {
      const stopPropagation = vi.fn();
      stopCompactComposerMenuNavigationKeyPropagation({ key, stopPropagation });
      expect(stopPropagation, key).toHaveBeenCalledOnce();
    }

    for (const key of ["Enter", "Escape", "Tab", "a"]) {
      const stopPropagation = vi.fn();
      stopCompactComposerMenuNavigationKeyPropagation({ key, stopPropagation });
      expect(stopPropagation, key).not.toHaveBeenCalled();
    }
  });

  it("keeps the compact popup at its existing width without context content", () => {
    expect(renderMenu()).not.toContain("w-72");
  });
});
