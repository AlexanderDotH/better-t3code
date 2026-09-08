import type { EffectCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "~/test/reactHookHarness";

const effects = vi.hoisted(() => [] as EffectCallback[]);
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("~/test/reactHookHarness");
  return {
    ...actual,
    ...reactHookHarness,
    useEffect: (effect: EffectCallback) => effects.push(effect),
    useLayoutEffect: (effect: EffectCallback) => effects.push(effect),
  };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("~/test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

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
    hooks.reset();
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
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
    function render(overrides: Partial<typeof input> = {}) {
      hooks.beginRender();
      effects.length = 0;
      const lifecycle = useWorkspaceCardDeckMorphLifecycle({ ...input, ...overrides });
      lifecycle.registerMorphHost("chat", intrinsic);
      lifecycle.registerMorphHost("git", intrinsic);
      const peekSlot = { querySelector: () => surface } as unknown as HTMLDivElement;
      lifecycle.registerPeekSlot("chat", peekSlot);
      lifecycle.registerPeekSlot("git", peekSlot);
      for (const effect of effects) effect();
      return lifecycle;
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
