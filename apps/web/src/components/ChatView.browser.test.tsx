import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentConnectionLease } from "@t3tools/client-runtime/connection";
import { ThreadId, type ServerConfig } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  emitThreadEvent,
  installFakeEnvironment,
  runningRun,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer, Effect] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
    import("effect/Effect"),
  ]);
  return {
    ...actual,
    layer: Layer.succeed(actual.ConnectionDriver, {
      ...fakeDriver,
      connect: (entry: Parameters<FakeDriver["connect"]>[0]) =>
        Effect.map(fakeDriver.connect(entry), withUsageLimitsConnection),
    }),
  };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("a new draft does not load its reserved thread before the server lists it", async () => {
  using _environment = installFakeEnvironment([]);
  using fetchSpy = vi.spyOn(globalThis, "fetch");
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const draftId = DraftId.make("draft-27443");
  const threadId = ThreadId.make("thread-27443");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });

  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  // The shell snapshot has arrived once the sidebar lists the project, so the connection is up.
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();

  const threadRequests = fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes(`/api/orchestration/threads/${threadId}/`));
  // A 404 here marks the thread deleted, and the view never loads it once the send creates it.
  expect(threadRequests).toEqual([]);
});

it("shows no empty composer notice while a turn runs without reasoning", async () => {
  const thread = threadWithHistory("no-reasoning", 1);
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    showReasoning: true,
    betterT3Device: {
      ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
      flags: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device.flags,
        "agent.reasoningWorkingOverlay": true,
        "chat.workingStatusInHeader": true,
      },
    },
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Answer 0 for no-reasoning.")).toBeVisible();

  await act(() =>
    emitThreadEvent(thread.id, {
      type: "run.created",
      payload: runningRun(thread.id, "no-reasoning-live", 2, "no-reasoning-live-user"),
    }),
  );

  await vi.waitFor(() =>
    expect(document.querySelector("[data-chat-header-working-status]")).not.toBeNull(),
  );
  expect(document.querySelector("[data-composer-banner-surface]")).toBeNull();
});

function withUsageLimits(config: ServerConfig): ServerConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => ({
      ...provider,
      usageLimits: {
        checkedAt: provider.checkedAt,
        windows: [
          {
            id: "primary",
            kind: "session",
            label: "Session",
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: "2099-01-01T00:00:00.000Z",
          },
          { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40 },
        ],
      },
    })),
  };
}

function withUsageLimitsConnection(lease: EnvironmentConnectionLease): EnvironmentConnectionLease {
  const subscribeServerConfig: typeof lease.session.subscribeServerConfig = (input) =>
    Stream.map(lease.session.client.subscribeServerConfig(input), (event) =>
      event.type === "snapshot" ? { ...event, config: withUsageLimits(event.config) } : event,
    );
  return {
    ...lease,
    session: {
      ...lease.session,
      initialConfig: Effect.map(lease.session.initialConfig, withUsageLimits),
      subscribeServerConfig,
      client: new Proxy(lease.session.client, {
        get: (target, property, receiver) =>
          property === "subscribeServerConfig"
            ? subscribeServerConfig
            : Reflect.get(target, property, receiver),
      }),
    },
  };
}

function finishLayoutAnimations(element: Element) {
  for (const animation of element.getAnimations({ subtree: true })) {
    if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
  }
}

it.each(
  (["classic", "current"] as const).flatMap((composerLayout) =>
    [false, true].flatMap((floatingBubble) =>
      [30, 80].map((distance) => ({ composerLayout, floatingBubble, distance })),
    ),
  ),
)(
  "keeps the timeline stable when the $composerLayout composer rests after $distance px (bubble: $floatingBubble)",
  async ({ composerLayout, floatingBubble, distance }) => {
    const matchMedia = window.matchMedia.bind(window);
    using _reducedMotion = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const media = matchMedia(query);
      if (query === "(prefers-reduced-motion: reduce)") {
        Object.defineProperty(media, "matches", { value: true });
      }
      return media;
    });
    const previousViewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(1280, 800);
    await using _viewport = {
      [Symbol.asyncDispose]: () => page.viewport(previousViewport.width, previousViewport.height),
    };
    const scenario = `scroll-collapse-${composerLayout}-${floatingBubble}-${distance}`;
    const thread = threadWithHistory(scenario, 5);
    using _environment = installFakeEnvironment([thread]);
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      composerCollapseOnScroll: true,
      composerUsageLimitsVisible: true,
      composerLayout,
      panelAnimationDurationMs: 0,
      betterT3Device: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
        flags: {
          ...DEFAULT_CLIENT_SETTINGS.betterT3Device.flags,
          "chat.workspaceCardDeck": floatingBubble,
          "chat.presentationMotion": false,
        },
      },
    });
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
    );
    await router.load();
    const container = document.createElement("div");
    container.style.cssText = "height: 700px; width: 1200px;";
    await using screen = await render(<AppRoot router={router} />, {
      container,
      // AppRoot brings its own router.
      router: false,
    });
    await expect.element(page.getByText(`Answer 4 for ${scenario}.`)).toBeVisible();
    await expect.element(page.getByText("Usage limits", { exact: true })).toBeVisible();
    await expect.element(page.getByTestId("composer-editor")).toHaveFocus();
    await act(() =>
      emitThreadEvent(thread.id, {
        type: "run.created",
        payload: runningRun(thread.id, "scroll-collapse-live", 6, "scroll-collapse-live-user"),
      }),
    );
    await expect.element(page.getByRole("button", { name: "Stop generation" })).toBeVisible();

    const viewport = screen.container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
    const inset = screen.container.querySelector<HTMLElement>("[data-timeline-composer-inset]")!;
    const composer = screen.container.querySelector<HTMLElement>("[data-chat-composer-resting]")!;
    await act(() => {
      finishLayoutAnimations(screen.container);
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
    });
    await vi.waitFor(() => {
      expect(inset.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBeGreaterThan(80);
      expect(viewport.scrollTop).toBeCloseTo(viewport.scrollHeight - viewport.clientHeight, 0);
    });
    await act(() => viewport.dispatchEvent(new Event("scroll")));
    const endOffset = viewport.scrollTop;
    const contentHeight = viewport.scrollHeight;
    const expandedInset = inset.getBoundingClientRect().height;
    const overlay = screen.container.querySelector<HTMLElement>("[data-chat-composer-overlay]")!;
    const lastMessage = screen.container.querySelector<HTMLElement>(
      `[data-message-id="${thread.id}-assistant-4"]`,
    )!;

    const readingOffset = endOffset - distance;
    await act(() => {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -distance, bubbles: true }));
      viewport.scrollTo({ top: readingOffset, behavior: "instant" });
      finishLayoutAnimations(screen.container);
    });
    await vi.waitFor(() => {
      expect(composer.dataset.chatComposerResting).toBe("true");
      expect(overlay.querySelector("[data-composer-banner-compact]")).not.toBeNull();
      expect(inset.getBoundingClientRect().height).toBe(expandedInset);
      expect(viewport.scrollHeight).toBe(contentHeight);
      expect(viewport.scrollTop).toBe(readingOffset);
    });
    if (distance === 80) {
      await expect.element(page.getByRole("button", { name: /^Scroll to end/ })).toBeVisible();
      await page.getByRole("button", { name: "Expand composer: Usage limits" }).click();
      await act(() => finishLayoutAnimations(screen.container));
    } else {
      await act(() => {
        viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: distance, bubbles: true }));
        viewport.scrollTo({ top: endOffset, behavior: "instant" });
        finishLayoutAnimations(screen.container);
      });
    }
    await vi.waitFor(() => {
      expect(composer.dataset.chatComposerResting).toBe("false");
      expect(overlay.querySelector("[data-composer-banner-compact]")).toBeNull();
      expect(inset.getBoundingClientRect().height).toBe(expandedInset);
      expect(viewport.scrollHeight).toBe(contentHeight);
      expect(viewport.scrollTop).toBe(distance === 80 ? readingOffset : endOffset);
      if (distance === 30) {
        expect(lastMessage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          overlay.getBoundingClientRect().top,
        );
      }
    });
    if (distance === 30) {
      await expect
        .element(page.getByRole("button", { name: /^Scroll to end/ }))
        .not.toBeInTheDocument();
    }
  },
);
