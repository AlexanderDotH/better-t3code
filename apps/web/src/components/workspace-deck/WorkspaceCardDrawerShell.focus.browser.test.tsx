import { act, render as renderTest, type Screen } from "../../../test/render";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () =>
      createInterfaceTranslator({
        language: "en",
        locale: "en-US",
      }),
  };
});
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
import { WorkspaceCardDrawerShell } from "./WorkspaceCardDrawerShell";
it("preserves input focus across callback changes and restores the original trigger on close", async () => {
  await using fixture = await setupFixture();
  const { renderDrawer, flushFrames, branchInput } = fixture;
  const initialClose = vi.fn();
  const latestClose = vi.fn();
  const handleEscape = vi.fn(() => true);
  await renderDrawer(true, initialClose);
  await flushFrames();
  expect(document.activeElement).toBe(
    fixture.container.querySelector("[data-workspace-card-drawer-initial-focus]"),
  );
  const input = branchInput();
  input.focus();
  input.value = "feature/keep-typing";
  input.setSelectionRange(7, 7);
  await renderDrawer(true, latestClose, handleEscape);
  await flushFrames();
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
  await act(escape);
  expect(handleEscape).toHaveBeenCalledOnce();
  expect(latestClose).not.toHaveBeenCalled();
  handleEscape.mockReturnValue(false);
  await act(escape);
  expect(latestClose).toHaveBeenCalledWith(false);
  expect(initialClose).not.toHaveBeenCalled();
  await renderDrawer(false, latestClose);
  await flushFrames();
  expect(document.activeElement).toBe(fixture.trigger);
});
it("preserves a child's explicit input focus before the first opening frame", async () => {
  await using fixture = await setupFixture();
  const { renderDrawer, branchInput, flushFrames } = fixture;
  await renderDrawer(true);
  const input = branchInput();
  input.focus();
  await flushFrames();
  expect(document.activeElement).toBe(input);
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  let screen: Screen;
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  async function flushFrames() {
    await act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(0);
    });
  }
  async function renderDrawer(
    open: boolean,
    onOpenChange = vi.fn(),
    onEscapeBeforeCollapse?: () => boolean,
  ) {
    await act(async () => {
      await screen.rerender(
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
          {...(onEscapeBeforeCollapse
            ? {
                onEscapeBeforeCollapse,
              }
            : {})}
        >
          <input aria-label="New branch name" />
        </WorkspaceCardDrawerShell>,
      );
    });
  }
  function branchInput() {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="New branch name"]');
    if (!input) throw new Error("Missing branch input");
    return input;
  }
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen?.unmount();
    });
    trigger?.remove();
    container?.remove();
    frames.clear();
    vi.unstubAllGlobals();
  });
  try {
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
    screen = fixtureResources.use(
      await renderTest(null, {
        container: container,
        // This fixture exercises local state without navigation.
        router: false,
      }),
    );
    return {
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      get container() {
        return container;
      },
      set container(value: HTMLDivElement) {
        container = value;
      },
      get trigger() {
        return trigger;
      },
      set trigger(value: HTMLButtonElement) {
        trigger = value;
      },
      get frameId() {
        return frameId;
      },
      set frameId(value) {
        frameId = value;
      },
      frames,
      flushFrames,
      renderDrawer,
      branchInput,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
