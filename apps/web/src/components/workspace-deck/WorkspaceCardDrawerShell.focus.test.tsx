import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));

import { WorkspaceCardDrawerShell } from "./WorkspaceCardDrawerShell";

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves input focus across callback changes and restores the original trigger on close", async () => {
  class FocusTarget {
    isConnected = true;
    focus() {
      document.activeElement = this;
    }
  }
  const trigger = new FocusTarget();
  const collapse = new FocusTarget();
  const branchInput = new FocusTarget();
  const document = Object.assign(new EventTarget(), { activeElement: trigger });
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  });
  const initialClose = vi.fn();
  const latestClose = vi.fn();
  const handleEscape = vi.fn(() => true);
  const drawer = (open: boolean, onOpenChange = initialClose, interceptEscape?: () => boolean) => (
    <WorkspaceCardDrawerShell
      open={open}
      sizingMode="content"
      availableHeight={620}
      activeTab="branches"
      ariaLabel="Git workspace"
      collapseLabel="Collapse Git workspace"
      tabs={[]}
      title="Git workspace"
      onActiveTabChange={vi.fn()}
      onOpenChange={onOpenChange}
      {...(interceptEscape ? { onEscapeBeforeCollapse: interceptEscape } : {})}
    >
      <input aria-label="New branch name" />
    </WorkspaceCardDrawerShell>
  );
  await act(() => {
    renderer = create(drawer(true), {
      createNodeMock: (element) =>
        element.type === "section" ? { querySelector: () => collapse } : null,
    });
  });
  await act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(collapse);

  branchInput.focus();
  await act(() => renderer?.update(drawer(true, latestClose, handleEscape)));
  await act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(branchInput);

  const escape = () =>
    document.dispatchEvent(
      Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }),
    );
  escape();
  expect(handleEscape).toHaveBeenCalledOnce();
  expect(latestClose).not.toHaveBeenCalled();

  handleEscape.mockReturnValue(false);
  escape();
  expect(latestClose).toHaveBeenCalledWith(false);
  expect(initialClose).not.toHaveBeenCalled();

  await act(() => renderer?.update(drawer(false, latestClose)));
  await act(() => vi.runAllTimers());
  expect(document.activeElement).toBe(trigger);
});
