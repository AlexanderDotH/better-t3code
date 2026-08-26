import { useMemo, useState } from "react";
import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import "../../index.css";
import { ChatWorkspaceDeck } from "../git-workbench/ChatWorkspaceDeck";
import { type WorkspaceDeckCardDefinition } from "./WorkspaceCardDeck";
import { WorkspaceCardPeek } from "./WorkspaceCardPeek";
import {
  captureWorkspaceDeckSurface,
  WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
  WORKSPACE_DECK_MORPH_DURATION_MS,
} from "./workspaceCardDeck.morph";

type CardId = "chat" | "git" | "example";

const COMPACT_CONTENT_HEIGHT: Readonly<Record<CardId, number>> = {
  chat: 166,
  git: 214,
  example: 128,
};

const ACTIVE_SURFACE_COLOR: Readonly<Record<CardId, string>> = {
  chat: "rgb(32, 40, 56)",
  git: "rgb(48, 66, 84)",
  example: "rgb(70, 50, 78)",
};

function CardSurface(props: {
  readonly id: CardId;
  readonly compactContentHeight: number;
  readonly expanded: boolean;
  readonly onExpand: () => void;
}) {
  if (props.id === "chat") {
    return (
      <article
        className="chat-composer-glass-shell h-full"
        data-workspace-card-compact-surface="true"
      >
        <div className="chat-composer-glass-host h-full">
          <div
            data-workspace-card-compact-content="true"
            style={{ minHeight: `${props.compactContentHeight + 26}px` }}
          >
            <strong>{props.id}</strong>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="h-full rounded-[22px] border border-border bg-card p-3"
      data-workspace-card-compact-surface="true"
      data-workspace-card-expanded-surface={props.expanded ? "true" : undefined}
      style={{
        backgroundColor: ACTIVE_SURFACE_COLOR[props.id],
        ...(props.expanded ? { height: "430px" } : {}),
      }}
    >
      <div
        data-workspace-card-compact-content="true"
        hidden={props.expanded}
        style={{ minHeight: `${props.compactContentHeight}px` }}
      >
        <strong>{props.id}</strong>
        {props.id !== "chat" ? (
          <button
            type="button"
            aria-label={`Expand test ${props.id} card`}
            onClick={props.onExpand}
          >
            Expand
          </button>
        ) : null}
      </div>
      {props.expanded ? <div data-expanded-test-workbench="true">Expanded workbench</div> : null}
    </article>
  );
}

function DeckHarness() {
  const [activeCard, setActiveCard] = useState<CardId>("chat");
  const [expandedCard, setExpandedCard] = useState<CardId | null>(null);
  const [chatCompactContentHeight, setChatCompactContentHeight] = useState(
    COMPACT_CONTENT_HEIGHT.chat,
  );
  const [gitCompactContentHeight, setGitCompactContentHeight] = useState(
    COMPACT_CONTENT_HEIGHT.git,
  );
  const cards = useMemo<readonly WorkspaceDeckCardDefinition<CardId>[]>(
    () =>
      (["chat", "git", "example"] as const).map((id) => ({
        id,
        label: `${id} workspace`,
        renderBody: ({ expanded }) => (
          <CardSurface
            id={id}
            compactContentHeight={
              id === "chat"
                ? chatCompactContentHeight
                : id === "git"
                  ? gitCompactContentHeight
                  : COMPACT_CONTENT_HEIGHT[id]
            }
            expanded={expanded}
            onExpand={() => setExpandedCard(id)}
          />
        ),
        renderPeek: ({ blocked, position, requestActivation }) => (
          <WorkspaceCardPeek
            blocked={blocked}
            cardId={id}
            label={`${id} workspace`}
            position={position}
            onActivate={requestActivation}
          >
            <span data-workspace-card-peek-id={id}>
              {id}
              {id === "git" ? (
                <button
                  type="button"
                  aria-label="Test branch control"
                  data-git-workspace-context-control="true"
                >
                  main
                </button>
              ) : null}
            </span>
          </WorkspaceCardPeek>
        ),
      })),
    [chatCompactContentHeight, gitCompactContentHeight],
  );

  return (
    <div className="mx-auto mt-24 w-[min(760px,calc(100vw-40px))]">
      <ChatWorkspaceDeck
        actionRequired={false}
        activeCard={activeCard}
        cards={cards}
        expandedCard={expandedCard}
        isRecording={false}
        resetKey="browser-fixed-targets"
        onActiveCardChange={setActiveCard}
        onExpandedCardChange={setExpandedCard}
      />
      <button
        type="button"
        className="mt-4"
        aria-label="Shrink test Git card"
        onClick={() => setGitCompactContentHeight(92)}
      >
        Shrink Git
      </button>
      <button
        type="button"
        className="mt-4"
        aria-label="Grow test Chat card"
        onClick={() => setChatCompactContentHeight(210)}
      >
        Grow Chat
      </button>
    </div>
  );
}

interface PeekGeometry {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly x: number;
  readonly y: number;
  readonly viewportHeight: number;
  readonly compactHeight: string;
}

function readPeekGeometry(position: "previous" | "next"): PeekGeometry {
  const peek = document.querySelector<HTMLElement>(
    `[data-workspace-card-peek][data-peek-position="${position}"]`,
  );
  expect(peek).not.toBeNull();
  const rect = peek!.getBoundingClientRect();
  const viewport = document.querySelector<HTMLElement>(".workspace-card-deck__viewport")!;
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    viewportHeight: viewport.getBoundingClientRect().height,
    compactHeight: viewport.style.getPropertyValue("--workspace-card-deck-compact-height"),
  };
}

function expectSamePeekGeometry(actual: PeekGeometry, expected: PeekGeometry): void {
  expect(
    Math.abs(actual.top - expected.top),
    `peek geometry changed: ${JSON.stringify({ actual, expected })}`,
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.bottom - expected.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.right - expected.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - 32)).toBeLessThanOrEqual(1);
}

function expectSameRect(actual: DOMRect, expected: DOMRect, label: string): void {
  const delta = {
    bottom: actual.bottom - expected.bottom,
    left: actual.left - expected.left,
    right: actual.right - expected.right,
    top: actual.top - expected.top,
  };
  expect(
    Object.values(delta).every((value) => Math.abs(value) <= 1),
    `${label} drifted from its content: ${JSON.stringify({
      actual: actual.toJSON(),
      delta,
      expected: expected.toJSON(),
    })}`,
  ).toBe(true);
}

interface VisibleCornerRadius {
  readonly x: number;
  readonly y: number;
}

function readVisibleCornerRadii(element: HTMLElement): readonly VisibleCornerRadius[] {
  const style = getComputedStyle(element);
  const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((radius) => {
    const [x = 0, y = x] = radius.split(" ").map((value) => Number.parseFloat(value));
    return { x: x * scaleX, y: y * scaleY };
  });
}

function expectSameVisibleRadii(
  actual: readonly VisibleCornerRadius[],
  expected: readonly VisibleCornerRadius[],
  label: string,
): void {
  const deltas = actual.map((radius, index) => ({
    x: radius.x - expected[index]!.x,
    y: radius.y - expected[index]!.y,
  }));
  expect(
    deltas.every(({ x, y }) => Math.abs(x) <= 1 && Math.abs(y) <= 1),
    `${label} corner radii drifted: ${JSON.stringify({ actual, deltas, expected })}`,
  ).toBe(true);
}

async function clickFixedPoint(
  point: Pick<PeekGeometry, "x" | "y">,
  expectedCard: CardId,
  inspectMorph?: () => void | Promise<void>,
) {
  const hit = document.elementFromPoint(point.x, point.y);
  const trigger = hit?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]');
  const activeCard = document.querySelector<HTMLElement>(
    '[data-workspace-card-body][data-card-position="active"]',
  );
  expect(
    trigger,
    `fixed point hit ${hit instanceof HTMLElement ? hit.outerHTML : String(hit)}; active=${JSON.stringify(
      activeCard
        ? {
            overflow: getComputedStyle(activeCard).overflow,
            rect: activeCard.getBoundingClientRect().toJSON(),
            point,
          }
        : null,
    )}`,
  ).not.toBeNull();
  trigger!.click();

  await vi.waitFor(() => {
    expect(
      document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
    ).toBe(expectedCard);
  });
  await vi.waitFor(() => {
    expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).not.toBeNull();
  });
  await inspectMorph?.();
  await vi.waitFor(
    () => {
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
    },
    { timeout: 2_000, interval: 16 },
  );
  const settledDeck = document.querySelector<HTMLElement>("[data-workspace-card-deck]")!;
  expect(settledDeck.querySelectorAll('[data-surface-morph-proxy^="deck-"]')).toHaveLength(0);
  expect(settledDeck.querySelectorAll('[data-deck-morph-surface="true"]')).toHaveLength(0);
}

async function expectActiveDeckMorph(expectedCard: CardId): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelectorAll('[data-surface-morph-proxy^="deck-"]')).toHaveLength(2);
  });
  const deck = document.querySelector<HTMLElement>("[data-workspace-card-deck]")!;
  const incoming = deck.querySelector<HTMLElement>(
    `[data-workspace-card-body="${expectedCard}"] .workspace-card-deck__intrinsic`,
  )!;
  const outgoing = deck.querySelector<HTMLElement>(
    '[data-transition-role="outgoing"] .workspace-card-deck__intrinsic',
  )!;
  const proxies = Array.from(
    deck.querySelectorAll<HTMLElement>('[data-surface-morph-proxy^="deck-"]'),
  );
  const incomingProxy = deck.querySelector<HTMLElement>(
    '[data-surface-morph-proxy="deck-incoming"]',
  )!;
  const outgoingProxy = deck.querySelector<HTMLElement>(
    '[data-surface-morph-proxy="deck-outgoing"]',
  )!;
  const incomingSurface = incoming.querySelector<HTMLElement>(
    '[data-workspace-card-compact-surface="true"]',
  )!;
  const backPeek = deck.querySelector<HTMLElement>('[data-deck-morph-back-peek="true"]');
  const animations = document
    .getAnimations()
    .filter((animation) => animation.id.startsWith("workspace-deck-"));
  for (const animation of animations)
    animation.currentTime = WORKSPACE_DECK_MORPH_DURATION_MS * 0.25;

  expect(deck.dataset.deckMotion).toBe("morph");
  expect(getComputedStyle(incoming).overflow).toBe("clip");
  expect(getComputedStyle(incoming).transform).not.toBe("none");
  expect(getComputedStyle(outgoing).transform).not.toBe("none");
  expect(Number.parseFloat(getComputedStyle(incoming).opacity)).toBeGreaterThan(
    WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
  );
  expect(Number.parseFloat(getComputedStyle(incoming).opacity)).toBeLessThan(1);
  expect(Number.parseFloat(getComputedStyle(outgoing).opacity)).toBeGreaterThanOrEqual(
    WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
  );
  expect(Number.parseFloat(getComputedStyle(outgoing).opacity)).toBeLessThan(1);
  const incomingSurfaceStyle = getComputedStyle(incomingSurface);
  expect(
    [
      incomingSurfaceStyle.borderTopLeftRadius,
      incomingSurfaceStyle.borderTopRightRadius,
      incomingSurfaceStyle.borderBottomRightRadius,
      incomingSurfaceStyle.borderBottomLeftRadius,
    ].every((radius) => Number.parseFloat(radius) > 0),
  ).toBe(true);
  expect(backPeek).not.toBeNull();
  const activeRect = deck
    .querySelector<HTMLElement>('[data-card-position="active"]')!
    .getBoundingClientRect();
  const backPeekRect = backPeek!.getBoundingClientRect();
  const backPeekAbove = backPeekRect.top < activeRect.top;
  const seamOverlap = backPeekAbove
    ? backPeekRect.bottom - activeRect.top
    : activeRect.bottom - backPeekRect.top;
  expect(seamOverlap).toBeGreaterThanOrEqual(-0.5);
  expect(seamOverlap).toBeLessThanOrEqual(3.5);
  expect(Number.parseFloat(getComputedStyle(backPeek!).opacity)).toBeGreaterThan(0);
  expect(Number.parseFloat(getComputedStyle(backPeek!).opacity)).toBeLessThan(1);
  expect(getComputedStyle(incomingProxy).position).toBe("absolute");
  expect(incomingProxy.offsetParent).toBe(incomingProxy.parentElement);
  expect(outgoingProxy.offsetParent).toBe(outgoingProxy.parentElement);
  expectSameRect(
    incomingProxy.getBoundingClientRect(),
    incomingSurface.getBoundingClientRect(),
    "incoming chrome",
  );
  expectSameVisibleRadii(
    readVisibleCornerRadii(incoming),
    readVisibleCornerRadii(incomingProxy),
    "incoming content",
  );
  expectSameRect(
    outgoingProxy.getBoundingClientRect(),
    outgoing
      .querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!
      .getBoundingClientRect(),
    "outgoing chrome",
  );
  const appearanceAnimation = animations.find((animation) =>
    animation.id.endsWith("-incoming-glass"),
  );
  const outgoingAppearanceAnimation = animations.find((animation) =>
    animation.id.endsWith("-outgoing-glass"),
  );
  expect(appearanceAnimation).toBeDefined();
  expect(outgoingAppearanceAnimation).toBeDefined();
  const appearanceKeyframes = (appearanceAnimation!.effect as KeyframeEffect).getKeyframes();
  const outgoingAppearanceKeyframes = (
    outgoingAppearanceAnimation!.effect as KeyframeEffect
  ).getKeyframes();
  expect(
    appearanceKeyframes.every((keyframe) => typeof keyframe.backgroundColor === "string"),
  ).toBe(true);
  expect(appearanceKeyframes.at(-1)?.backgroundColor).toBe(
    expectedCard === "chat"
      ? captureWorkspaceDeckSurface(incomingSurface).appearance.backgroundColor
      : ACTIVE_SURFACE_COLOR[expectedCard],
  );
  expect(appearanceKeyframes.some((keyframe) => Object.hasOwn(keyframe, "background"))).toBe(false);
  expect(outgoingAppearanceKeyframes[0]?.backgroundColor).toBe(
    captureWorkspaceDeckSurface(
      outgoing.querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!,
    ).appearance.backgroundColor,
  );
  for (const proxy of proxies) {
    expect(proxy.getAttribute("aria-hidden")).toBe("true");
    expect(proxy.hasAttribute("inert")).toBe(true);
    expect(getComputedStyle(proxy).pointerEvents).toBe("none");
    expect(Number.parseFloat(getComputedStyle(proxy).borderTopWidth)).toBe(1);
  }
}

describe("WorkspaceCardDeck fixed browser geometry", () => {
  it("uses Chat height and collapses an expanded panel before shuffling", async () => {
    await page.viewport(840, 620);
    document.documentElement.classList.add("dark");
    const mounted = await render(<DeckHarness />);

    try {
      await vi.waitFor(() => {
        const cardRects = Array.from(
          document.querySelectorAll<HTMLElement>("[data-workspace-card-body]"),
          (card) => card.getBoundingClientRect(),
        );
        expect(cardRects).toHaveLength(3);
        expect(Math.abs(cardRects[0]!.height - 192)).toBeLessThanOrEqual(1);
        expect(cardRects.every((rect) => Math.abs(rect.height - cardRects[0]!.height) <= 1)).toBe(
          true,
        );
      });

      const initialUpper = readPeekGeometry("previous");
      const initialLower = readPeekGeometry("next");
      const upperPeekStyle = getComputedStyle(
        document.querySelector<HTMLElement>(
          '[data-workspace-card-peek][data-peek-position="previous"]',
        )!,
      );
      expect(upperPeekStyle.boxShadow).toContain("-12px");
      expect(upperPeekStyle.opacity).toBe("1");
      expect(upperPeekStyle.backdropFilter).not.toBe("none");
      expect(upperPeekStyle.backgroundColor).not.toBe(
        getComputedStyle(document.body).backgroundColor,
      );
      const chatRect = document
        .querySelector<HTMLElement>('[data-workspace-card-body="chat"]')!
        .getBoundingClientRect();
      expect(Math.abs(initialUpper.bottom - chatRect.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(initialLower.top - chatRect.bottom)).toBeLessThanOrEqual(1);
      document.querySelector<HTMLButtonElement>('[aria-label="Test branch control"]')!.click();
      expect(
        document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
      ).toBe("chat");

      await clickFixedPoint(initialLower, "git", () => expectActiveDeckMorph("git"));
      expectSamePeekGeometry(readPeekGeometry("previous"), initialUpper);
      expectSamePeekGeometry(readPeekGeometry("next"), initialLower);
      await clickFixedPoint(initialLower, "example");
      await clickFixedPoint(initialLower, "chat");
      expectSamePeekGeometry(readPeekGeometry("previous"), initialUpper);
      expectSamePeekGeometry(readPeekGeometry("next"), initialLower);

      await clickFixedPoint(initialUpper, "example");
      await clickFixedPoint(initialUpper, "git");
      await clickFixedPoint(initialUpper, "chat");
      expectSamePeekGeometry(readPeekGeometry("previous"), initialUpper);
      expectSamePeekGeometry(readPeekGeometry("next"), initialLower);

      document.querySelector<HTMLButtonElement>('[aria-label="Shrink test Git card"]')!.click();
      await vi.waitFor(() => {
        const chatCard = document
          .querySelector<HTMLElement>('[data-workspace-card-body="chat"]')!
          .getBoundingClientRect();
        expect(Math.abs(chatCard.height - 192)).toBeLessThanOrEqual(1);
        const cardRects = Array.from(
          document.querySelectorAll<HTMLElement>("[data-workspace-card-body]"),
          (card) => card.getBoundingClientRect(),
        );
        expect(cardRects.every((rect) => Math.abs(rect.height - chatCard.height) <= 1)).toBe(true);
      });
      expectSamePeekGeometry(readPeekGeometry("previous"), initialUpper);
      expectSamePeekGeometry(readPeekGeometry("next"), initialLower);

      document.querySelector<HTMLButtonElement>('[aria-label="Grow test Chat card"]')!.click();
      await vi.waitFor(() => {
        const chatCard = document
          .querySelector<HTMLElement>('[data-workspace-card-body="chat"]')!
          .getBoundingClientRect();
        expect(Math.abs(chatCard.height - 236)).toBeLessThanOrEqual(1);
        const cardRects = Array.from(
          document.querySelectorAll<HTMLElement>("[data-workspace-card-body]"),
          (card) => card.getBoundingClientRect(),
        );
        expect(cardRects.every((rect) => Math.abs(rect.height - chatCard.height) <= 1)).toBe(true);
      });
      const resizedUpper = readPeekGeometry("previous");
      const resizedLower = readPeekGeometry("next");

      await clickFixedPoint(resizedLower, "git");
      document.querySelector<HTMLButtonElement>('[aria-label="Expand test git card"]')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-expanded-card="git"]')).not.toBeNull();
        expect(document.querySelector('[data-deck-expansion-morph="opening"]')).not.toBeNull();
        expect(document.querySelectorAll('[data-surface-morph-proxy^="deck-"]')).toHaveLength(1);
        expect(readPeekGeometry("next").bottom).toBeGreaterThan(initialLower.bottom + 100);
      });
      const expansionProxy = document.querySelector<HTMLElement>(
        '[data-surface-morph-proxy="deck-incoming"]',
      )!;
      const expandedIntrinsic = document.querySelector<HTMLElement>(
        '[data-workspace-card-intrinsic="git"]',
      )!;
      for (const animation of [
        ...expansionProxy.getAnimations(),
        ...expandedIntrinsic.getAnimations(),
      ]) {
        animation.currentTime = 210;
      }
      expectSameRect(
        expansionProxy.getBoundingClientRect(),
        document
          .querySelector<HTMLElement>(
            '[data-workspace-card-body="git"] [data-workspace-card-compact-surface="true"]',
          )!
          .getBoundingClientRect(),
        "expanded chrome",
      );

      const expandedUpper = readPeekGeometry("previous");
      document
        .elementFromPoint(expandedUpper.x, expandedUpper.y)
        ?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')
        ?.click();
      expect(
        document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
      ).toBe("git");
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-deck-collapsing="git"]')).not.toBeNull();
        expect(document.querySelector('[data-deck-expansion-morph="closing"]')).not.toBeNull();
        expect(readPeekGeometry("previous").viewportHeight).toBeGreaterThan(236);
      });
      await vi.waitFor(
        () => {
          expect(
            document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
          ).toBe("chat");
          expect(
            document.querySelector(".workspace-card-deck[data-deck-transition]"),
          ).not.toBeNull();
        },
        { timeout: 1_000, interval: 16 },
      );
      await vi.waitFor(
        () => {
          expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
        },
        { timeout: 2_000, interval: 16 },
      );
      expectSamePeekGeometry(readPeekGeometry("previous"), resizedUpper);
      expectSamePeekGeometry(readPeekGeometry("next"), resizedLower);

      await clickFixedPoint(resizedUpper, "example");
      document.querySelector<HTMLButtonElement>('[aria-label="Expand test example card"]')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-expanded-card="example"]')).not.toBeNull();
        const activeRect = document
          .querySelector<HTMLElement>('[data-card-position="active"]')!
          .getBoundingClientRect();
        expect(readPeekGeometry("next").top).toBeGreaterThanOrEqual(activeRect.bottom - 1);
      });
      const expandedNext = readPeekGeometry("next");
      document
        .elementFromPoint(expandedNext.x, expandedNext.y)
        ?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')
        ?.click();
      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
        ).toBe("chat");
      });
    } finally {
      await mounted.unmount();
      document.documentElement.classList.remove("dark");
    }
  });

  it("accepts the newly revealed peek while the previous morph is still running", async () => {
    await page.viewport(840, 620);
    document.documentElement.classList.add("dark");
    const mounted = await render(<DeckHarness />);

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-workspace-card-deck]")).not.toBeNull();
        expect(readPeekGeometry("next").height).toBeGreaterThan(0);
      });
      const expectedFinalChatColor = captureWorkspaceDeckSurface(
        document.querySelector<HTMLElement>(
          '[data-workspace-card-body="chat"] [data-workspace-card-compact-surface="true"]',
        )!,
      ).appearance.backgroundColor;
      const firstTarget = readPeekGeometry("next");
      document
        .elementFromPoint(firstTarget.x, firstTarget.y)
        ?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')
        ?.click();

      await vi.waitFor(() => {
        const deck = document.querySelector<HTMLElement>("[data-workspace-card-deck]")!;
        expect(deck.dataset.activeCard).toBe("git");
        expect(deck.dataset.deckMotion).toBe("morph");
        expect(deck.dataset.deckTransitionToken).toBeDefined();
        expect(deck.querySelector('[data-deck-morph-back-peek="true"]')).not.toBeNull();
      });
      const deck = document.querySelector<HTMLElement>("[data-workspace-card-deck]")!;
      const firstToken = deck.dataset.deckTransitionToken!;
      for (const animation of document.getAnimations()) {
        if (animation.id.startsWith(`workspace-deck-${firstToken}-`)) animation.currentTime = 80;
      }
      const firstVisibleColor = getComputedStyle(
        deck.querySelector<HTMLElement>('[data-surface-morph-proxy="deck-incoming"]')!,
      ).backgroundColor;
      const firstVisibleRect = deck
        .querySelector<HTMLElement>('[data-surface-morph-proxy="deck-incoming"]')!
        .getBoundingClientRect();
      const firstVisibleContent = deck.querySelector<HTMLElement>(
        '[data-workspace-card-intrinsic="git"]',
      )!;
      const firstVisibleContentRect = firstVisibleContent
        .querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!
        .getBoundingClientRect();
      const firstVisibleRadii = readVisibleCornerRadii(firstVisibleContent);
      const firstVisibleOpacity = Number.parseFloat(getComputedStyle(firstVisibleContent).opacity);

      const fastTarget = deck
        .querySelector<HTMLElement>('[data-workspace-card-peek-id="example"]')!
        .closest<HTMLElement>("[data-workspace-card-peek]")!;
      const fastTargetRect = fastTarget.getBoundingClientRect();
      expect(Number.parseFloat(getComputedStyle(fastTarget).opacity)).toBeGreaterThanOrEqual(0.72);
      expect(fastTargetRect.bottom).toBeLessThanOrEqual(deck.getBoundingClientRect().bottom + 0.5);
      const hit = document.elementFromPoint(
        fastTargetRect.left + fastTargetRect.width / 2,
        fastTargetRect.top + fastTargetRect.height / 2,
      );
      const trigger = hit?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]');
      expect(
        trigger,
        `rapid switch hit ${hit instanceof HTMLElement ? hit.outerHTML : String(hit)}`,
      ).not.toBeNull();
      trigger!.click();

      await vi.waitFor(() => {
        expect(deck.dataset.activeCard).toBe("example");
        expect(deck.dataset.deckTransitionToken).not.toBe(firstToken);
        expect(deck.dataset.deckMotion).toBe("morph");
      });
      const secondToken = deck.dataset.deckTransitionToken!;
      const secondOutgoingAppearance = document
        .getAnimations()
        .find((animation) => animation.id === `workspace-deck-${secondToken}-outgoing-glass`);
      expect(secondOutgoingAppearance).toBeDefined();
      expect(
        (secondOutgoingAppearance!.effect as KeyframeEffect).getKeyframes()[0]?.backgroundColor,
      ).toBe(firstVisibleColor);
      for (const animation of document.getAnimations()) {
        if (animation.id.startsWith(`workspace-deck-${secondToken}-`)) animation.currentTime = 0;
      }
      const secondOutgoingProxy = deck.querySelector<HTMLElement>(
        '[data-surface-morph-proxy="deck-outgoing"]',
      )!;
      const secondOutgoingContent = deck.querySelector<HTMLElement>(
        '[data-workspace-card-intrinsic="git"]',
      )!;
      expectSameRect(
        secondOutgoingProxy.getBoundingClientRect(),
        firstVisibleRect,
        "first interrupted chrome",
      );
      expectSameRect(
        secondOutgoingContent
          .querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!
          .getBoundingClientRect(),
        firstVisibleContentRect,
        "first interrupted content",
      );
      expectSameVisibleRadii(
        readVisibleCornerRadii(secondOutgoingContent),
        firstVisibleRadii,
        "first interrupted content",
      );
      expect(
        Math.abs(
          Number.parseFloat(getComputedStyle(secondOutgoingContent).opacity) - firstVisibleOpacity,
        ),
      ).toBeLessThanOrEqual(0.01);
      for (const animation of document.getAnimations()) {
        if (animation.id.startsWith(`workspace-deck-${secondToken}-`)) animation.currentTime = 80;
      }
      const secondVisibleColor = getComputedStyle(
        deck.querySelector<HTMLElement>('[data-surface-morph-proxy="deck-incoming"]')!,
      ).backgroundColor;
      const secondVisibleRect = deck
        .querySelector<HTMLElement>('[data-surface-morph-proxy="deck-incoming"]')!
        .getBoundingClientRect();
      const secondVisibleContent = deck.querySelector<HTMLElement>(
        '[data-workspace-card-intrinsic="example"]',
      )!;
      const secondVisibleContentRect = secondVisibleContent
        .querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!
        .getBoundingClientRect();
      const secondVisibleRadii = readVisibleCornerRadii(secondVisibleContent);
      const secondVisibleOpacity = Number.parseFloat(
        getComputedStyle(secondVisibleContent).opacity,
      );
      const finalTarget = deck
        .querySelector<HTMLElement>('[data-workspace-card-peek-id="chat"]')!
        .closest<HTMLElement>("[data-workspace-card-peek]")!;
      const finalTargetRect = finalTarget.getBoundingClientRect();
      document
        .elementFromPoint(
          finalTargetRect.left + finalTargetRect.width / 2,
          finalTargetRect.top + finalTargetRect.height / 2,
        )
        ?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')
        ?.click();

      await vi.waitFor(() => {
        expect(deck.dataset.activeCard).toBe("chat");
        expect(deck.dataset.deckTransitionToken).not.toBe(secondToken);
        expect(deck.dataset.deckMotion).toBe("morph");
      });
      const finalToken = deck.dataset.deckTransitionToken!;
      const finalOutgoingAppearance = document
        .getAnimations()
        .find((animation) => animation.id === `workspace-deck-${finalToken}-outgoing-glass`);
      const finalIncomingAppearance = document
        .getAnimations()
        .find((animation) => animation.id === `workspace-deck-${finalToken}-incoming-glass`);
      expect(finalOutgoingAppearance).toBeDefined();
      expect(finalIncomingAppearance).toBeDefined();
      expect(
        (finalOutgoingAppearance!.effect as KeyframeEffect).getKeyframes()[0]?.backgroundColor,
      ).toBe(secondVisibleColor);
      expect(
        (finalIncomingAppearance!.effect as KeyframeEffect).getKeyframes().at(-1)?.backgroundColor,
      ).toBe(expectedFinalChatColor);
      for (const animation of document.getAnimations()) {
        if (animation.id.startsWith(`workspace-deck-${finalToken}-`)) animation.currentTime = 0;
      }
      const finalOutgoingContent = deck.querySelector<HTMLElement>(
        '[data-workspace-card-intrinsic="example"]',
      )!;
      expectSameRect(
        deck
          .querySelector<HTMLElement>('[data-surface-morph-proxy="deck-outgoing"]')!
          .getBoundingClientRect(),
        secondVisibleRect,
        "second interrupted chrome",
      );
      expectSameRect(
        finalOutgoingContent
          .querySelector<HTMLElement>('[data-workspace-card-compact-surface="true"]')!
          .getBoundingClientRect(),
        secondVisibleContentRect,
        "second interrupted content",
      );
      expectSameVisibleRadii(
        readVisibleCornerRadii(finalOutgoingContent),
        secondVisibleRadii,
        "second interrupted content",
      );
      expect(
        Math.abs(
          Number.parseFloat(getComputedStyle(finalOutgoingContent).opacity) - secondVisibleOpacity,
        ),
      ).toBeLessThanOrEqual(0.01);
      await vi.waitFor(
        () => {
          expect(deck.dataset.deckTransition).toBeUndefined();
        },
        { timeout: 2_000, interval: 16 },
      );
      expect(deck.querySelectorAll('[data-surface-morph-proxy^="deck-"]')).toHaveLength(0);
      expect(deck.querySelectorAll('[data-deck-morph-surface="true"]')).toHaveLength(0);
      expect(deck.querySelector('[data-deck-morph-back-peek="true"]')).toBeNull();
      expect(
        captureWorkspaceDeckSurface(
          deck.querySelector<HTMLElement>(
            '[data-workspace-card-body="chat"] [data-workspace-card-compact-surface="true"]',
          )!,
        ).appearance.backgroundColor,
      ).toBe(expectedFinalChatColor);
      for (const intrinsic of deck.querySelectorAll<HTMLElement>(
        ".workspace-card-deck__intrinsic",
      )) {
        expect(intrinsic.style.transform).toBe("");
        expect(intrinsic.style.clipPath).toBe("");
        expect(intrinsic.style.borderRadius).toBe("");
      }
    } finally {
      await mounted.unmount();
      document.documentElement.classList.remove("dark");
    }
  });

  it("keeps chrome attached when a surrounding layout layer is transformed", async () => {
    await page.viewport(720, 620);
    document.documentElement.classList.add("dark");
    const mounted = await render(
      <div style={{ transform: "translate3d(13px, 17px, 0)" }}>
        <DeckHarness />
      </div>,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-workspace-card-deck]")).not.toBeNull();
        expect(readPeekGeometry("next").height).toBeGreaterThan(0);
      });
      await clickFixedPoint(readPeekGeometry("next"), "git", () => expectActiveDeckMorph("git"));
    } finally {
      await mounted.unmount();
      document.documentElement.classList.remove("dark");
    }
  });

  it("switches roles immediately when reduced motion is requested", async () => {
    await page.viewport(840, 620);
    const mediaQuery = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
    const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue(mediaQuery);
    const reducedMotionStyle = document.createElement("style");
    reducedMotionStyle.textContent =
      ".workspace-card-deck__viewport { transition: none !important; }";
    document.head.append(reducedMotionStyle);
    const mounted = await render(<DeckHarness />);

    try {
      await vi.waitFor(() => {
        expect(document.querySelector("[data-workspace-card-deck]")).not.toBeNull();
      });
      const upper = readPeekGeometry("previous");
      const hit = document.elementFromPoint(upper.x, upper.y);
      hit?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')?.click();

      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
        ).toBe("example");
      });
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();

      document.querySelector<HTMLButtonElement>('[aria-label="Expand test example card"]')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-expanded-card="example"]')).not.toBeNull();
      });
      const next = readPeekGeometry("next");
      const nextHit = document.elementFromPoint(next.x, next.y);
      const nextTrigger = nextHit?.closest<HTMLButtonElement>(
        '[data-workspace-card-peek-trigger="true"]',
      );
      const activeSection = document.querySelector<HTMLElement>('[data-card-position="active"]')!;
      const activeSurface = activeSection.querySelector<HTMLElement>(
        '[data-workspace-card-compact-surface="true"]',
      )!;
      expect(
        nextTrigger,
        `reduced-motion next peek hit ${nextHit instanceof HTMLElement ? nextHit.outerHTML : String(nextHit)}; geometry=${JSON.stringify(
          {
            next,
            activeSection: activeSection.getBoundingClientRect().toJSON(),
            activeSurface: activeSurface.getBoundingClientRect().toJSON(),
            viewport: document
              .querySelector<HTMLElement>(".workspace-card-deck__viewport")!
              .getBoundingClientRect()
              .toJSON(),
          },
        )}`,
      ).not.toBeNull();
      nextTrigger!.click();
      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
        ).toBe("chat");
      });
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
    } finally {
      await mounted.unmount();
      reducedMotionStyle.remove();
      matchMedia.mockRestore();
    }
  });
});
