import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_DURATION_MS,
  DRAFT_HERO_TRANSITION_EASING,
  runMobileComposerTransition,
  waitForDraftHeroTransition,
} from "./draftHeroTransition";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForDraftHeroTransition", () => {
  it("uses a short translation-only timing for the hero-to-dock handoff", () => {
    expect(DRAFT_HERO_TRANSITION_DURATION_MS).toBe(180);
    expect(DRAFT_HERO_TRANSITION_EASING).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
  });

  it("waits for active draft hero animations and ignores unrelated animations", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    vi.stubGlobal("document", {
      getAnimations: () => [
        { id: "unrelated-animation", finished: new Promise<void>(() => undefined) },
        { id: DRAFT_HERO_TRANSITION_ANIMATION_ID, finished: transitionFinished },
      ],
    });

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await handoff;
    expect(handoffComplete).toBe(true);
  });

  it("allows the handoff when an active transition is cancelled", async () => {
    vi.stubGlobal("document", {
      getAnimations: () => [
        {
          id: DRAFT_HERO_TRANSITION_ANIMATION_ID,
          finished: Promise.reject(new Error("cancelled")),
        },
      ],
    });

    await expect(waitForDraftHeroTransition()).resolves.toBeUndefined();
  });
});

describe("runMobileComposerTransition", () => {
  it("keeps the route handoff waiting while the mobile composer morph is active", async () => {
    let finishTransition: (() => void) | undefined;
    const transitionFinished = new Promise<void>((resolve) => {
      finishTransition = resolve;
    });
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: { dataset },
      getAnimations: () => [],
      startViewTransition: (update: () => void | Promise<void>) => {
        void update();
        return { finished: transitionFinished };
      },
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });

    const transition = runMobileComposerTransition(() => undefined);
    await Promise.resolve();

    let handoffComplete = false;
    const handoff = waitForDraftHeroTransition().then(() => {
      handoffComplete = true;
    });
    await Promise.resolve();
    expect(handoffComplete).toBe(false);

    finishTransition?.();
    await Promise.all([transition, handoff]);
    expect(handoffComplete).toBe(true);
  });

  it("uses a scoped view transition on mobile", async () => {
    const dataset: Record<string, string> = {};
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => ({
      finished: Promise.resolve(update()).then(() => undefined),
    }));
    vi.stubGlobal("document", {
      documentElement: { dataset },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query === "(max-width: 639px)" }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(dataset).not.toHaveProperty("mobileComposerRouteTransition");
  });

  it("updates without a view transition when reduced motion is preferred", async () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      startViewTransition,
    });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    const update = vi.fn();

    await runMobileComposerTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
});
