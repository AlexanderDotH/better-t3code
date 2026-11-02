import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

vi.mock("./workspaceCardDeck.morph", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaceCardDeck.morph")>()),
  captureWorkspaceDeckSurface: vi.fn(),
  createWorkspaceDeckMorphProxy: vi.fn(),
  markWorkspaceDeckMorphSurface: vi.fn(() => vi.fn()),
}));

import {
  captureWorkspaceDeckSurface,
  createWorkspaceDeckMorphProxy,
} from "./workspaceCardDeck.morph";
import { useWorkspaceCardDeckMorphLifecycle } from "./useWorkspaceCardDeckMorphLifecycle";

describe("workspace deck morph lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.mocked(captureWorkspaceDeckSurface).mockReturnValue({
      geometry: {
        rect: { left: 0, top: 0, width: 400, height: 180 },
        radii: { topLeft: 22, topRight: 22, bottomLeft: 22, bottomRight: 22 },
      },
      opacity: 1,
      appearance: {
        backdropFilter: "none",
        backgroundColor: "black",
        borderColor: "gray",
        boxShadow: "none",
      },
    });
    vi.mocked(createWorkspaceDeckMorphProxy).mockImplementation(() => ({
      element: { remove: vi.fn() } as unknown as HTMLDivElement,
      geometryAnimation: {
        cancel: vi.fn(),
        finished: new Promise<Animation>(() => {}),
      } as unknown as Animation,
      appearanceAnimation: null,
      cornerAnimation: null,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps running animations across renders, replaces them for a new selection, and settles reduced motion", () => {
    const surface = { querySelector: () => null } as unknown as HTMLElement;
    const intrinsic = {
      animate: vi.fn(),
      querySelector: (selector: string) => (selector.includes("compact-surface") ? surface : null),
    } as unknown as HTMLDivElement;
    const input: Parameters<typeof useWorkspaceCardDeckMorphLifecycle<string>>[0] = {
      activeCard: "chat",
      requestedActiveCard: "chat",
      cardIds: ["chat", "git"],
      compactHeightReferenceCard: "chat",
      expandedCard: null,
      focusDestination: vi.fn(),
      intrinsicElementRefs: {
        current: new Map([
          ["chat", intrinsic],
          ["git", intrinsic],
        ]),
      },
      measurements: { chat: 180 },
      onExpandedCardCollapseComplete: undefined,
      prefersReducedMotion: false,
      resetKey: "thread",
      selectionMode: "animate",
    };
    let current: ReturnType<typeof useWorkspaceCardDeckMorphLifecycle<string>> | undefined;
    function Probe({ value }: { value: typeof input }) {
      const next = useWorkspaceCardDeckMorphLifecycle(value);
      next.registerMorphHost("chat", intrinsic);
      next.registerMorphHost("git", intrinsic);
      const peekSlot = { querySelector: () => surface } as unknown as HTMLDivElement;
      next.registerPeekSlot("chat", peekSlot);
      next.registerPeekSlot("git", peekSlot);
      useLayoutEffect(() => {
        current = next;
      });
      return null;
    }
    let root: ReactTestRenderer | undefined;
    onTestFinished(async () => {
      await act(() => root?.unmount());
    });
    function render(overrides: Partial<typeof input> = {}) {
      act(() => {
        const element = createElement(Probe, { value: { ...input, ...overrides } });
        if (root) root.update(element);
        else root = create(element);
      });
      if (!current) throw new Error("The lifecycle did not mount.");
      return current;
    }
    let lifecycle = render();
    lifecycle.pendingMorphCaptureRef.current = lifecycle.captureMorphRequest({
      fromId: "chat",
      toId: "git",
      direction: "forward",
    });
    const git = { activeCard: "git", requestedActiveCard: "git" };
    render(git);
    lifecycle = render(git);
    const firstMorph = lifecycle.activeMorphRef.current;
    expect(firstMorph).not.toBeNull();
    expect(createWorkspaceDeckMorphProxy).toHaveBeenCalledTimes(2);

    // Fresh descriptor and measurement objects are normal during streaming.
    lifecycle = render({ ...git, cardIds: ["chat", "git"], measurements: { chat: 200 } });
    expect(lifecycle.activeMorphRef.current).toBe(firstMorph);
    expect(createWorkspaceDeckMorphProxy).toHaveBeenCalledTimes(2);
    expect(firstMorph?.animations[0]?.cancel).not.toHaveBeenCalled();

    lifecycle.pendingMorphCaptureRef.current = lifecycle.captureMorphRequest({
      fromId: "git",
      toId: "chat",
      direction: "backward",
    });
    lifecycle.cleanupActiveMorph();
    render();
    lifecycle = render();
    expect(lifecycle.activeMorphRef.current?.token).not.toBe(firstMorph?.token);
    expect(createWorkspaceDeckMorphProxy).toHaveBeenCalledTimes(4);
    expect(firstMorph?.animations[0]?.cancel).toHaveBeenCalledOnce();

    const secondMorph = lifecycle.activeMorphRef.current;
    lifecycle = render({ prefersReducedMotion: true });
    expect(lifecycle.activeMorphRef.current).toBeNull();
    expect(secondMorph?.animations[0]?.cancel).toHaveBeenCalledOnce();
    expect(createWorkspaceDeckMorphProxy).toHaveBeenCalledTimes(4);
    expect(input.focusDestination).toHaveBeenLastCalledWith("chat");
  });
});
