import { useMemo, useState } from "react";
import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import "../../index.css";
import { ChatWorkspaceDeck } from "../git-workbench/ChatWorkspaceDeck";
import { type WorkspaceDeckCardDefinition } from "./WorkspaceCardDeck";
import { WorkspaceCardPeek } from "./WorkspaceCardPeek";

type CardId = "chat" | "git" | "example";

const COMPACT_CONTENT_HEIGHT: Readonly<Record<CardId, number>> = {
  chat: 166,
  git: 214,
  example: 128,
};

function CardSurface(props: {
  readonly id: CardId;
  readonly compactContentHeight: number;
  readonly expanded: boolean;
  readonly onExpand: () => void;
}) {
  return (
    <article
      className="h-full rounded-[22px] border border-border bg-card p-3"
      data-workspace-card-compact-surface="true"
      style={props.expanded ? { height: "430px" } : undefined}
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

async function clickFixedPoint(point: Pick<PeekGeometry, "x" | "y">, expectedCard: CardId) {
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
  await vi.waitFor(
    () => {
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
    },
    { timeout: 2_000, interval: 16 },
  );
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

      await clickFixedPoint(initialLower, "git");
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
        expect(readPeekGeometry("next").bottom).toBeGreaterThan(initialLower.bottom + 100);
      });

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
      document
        .elementFromPoint(next.x, next.y)
        ?.closest<HTMLButtonElement>('[data-workspace-card-peek-trigger="true"]')
        ?.click();
      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-workspace-card-deck]")?.getAttribute("data-active-card"),
        ).toBe("chat");
      });
      expect(document.querySelector(".workspace-card-deck[data-deck-transition]")).toBeNull();
    } finally {
      await mounted.unmount();
      matchMedia.mockRestore();
    }
  });
});
