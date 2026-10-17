// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

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

let root: Root;
let container: HTMLDivElement;
let trigger: HTMLButtonElement;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  trigger = document.createElement("button");
  container = document.createElement("div");
  document.body.append(trigger, container);
  trigger.focus();
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  trigger.remove();
  container.remove();
  frames.clear();
  vi.unstubAllGlobals();
});

function flushFrames() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

function renderDrawer(
  open: boolean,
  onOpenChange = vi.fn(),
  onEscapeBeforeCollapse?: () => boolean,
) {
  act(() =>
    root.render(
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
        {...(onEscapeBeforeCollapse ? { onEscapeBeforeCollapse } : {})}
      >
        <input aria-label="New branch name" />
      </WorkspaceCardDrawerShell>,
    ),
  );
}

function branchInput() {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="New branch name"]');
  if (!input) throw new Error("Missing branch input");
  return input;
}

it("preserves input focus across callback changes and restores the original trigger on close", () => {
  const initialClose = vi.fn();
  const latestClose = vi.fn();
  const handleEscape = vi.fn(() => true);
  renderDrawer(true, initialClose);
  flushFrames();
  expect(document.activeElement).toBe(
    container.querySelector("[data-workspace-card-drawer-initial-focus]"),
  );

  const input = branchInput();
  input.focus();
  input.value = "feature/keep-typing";
  input.setSelectionRange(7, 7);
  renderDrawer(true, latestClose, handleEscape);
  flushFrames();
  expect(branchInput()).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("feature/keep-typing");
  expect(input.selectionStart).toBe(7);

  const escape = () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
        bubbles: true,
      }),
    );
  act(escape);
  expect(handleEscape).toHaveBeenCalledOnce();
  expect(latestClose).not.toHaveBeenCalled();
  handleEscape.mockReturnValue(false);
  act(escape);
  expect(latestClose).toHaveBeenCalledWith(false);
  expect(initialClose).not.toHaveBeenCalled();

  renderDrawer(false, latestClose);
  flushFrames();
  expect(document.activeElement).toBe(trigger);
});

it("preserves a child's explicit input focus before the first opening frame", () => {
  renderDrawer(true);
  const input = branchInput();
  input.focus();
  flushFrames();
  expect(document.activeElement).toBe(input);
});
