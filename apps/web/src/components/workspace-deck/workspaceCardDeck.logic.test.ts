import { describe, expect, it } from "vite-plus/test";

import {
  findDuplicateWorkspaceDeckCardId,
  pruneWorkspaceDeckMeasurements,
  resolveWorkspaceCardDrawerHeight,
  resolveWorkspaceCardDrawerHeightBounds,
  resolveWorkspaceDeckActiveCard,
  resolveWorkspaceDeckCompactHeight,
  resolveWorkspaceDeckDirection,
  resolveWorkspaceDeckRoles,
  resolveWorkspaceDeckSelection,
} from "./workspaceCardDeck.logic";

const repositoryCards = ["chat", "git", "example"] as const;

describe("workspace drawer height", () => {
  it("leaves 160 pixels for the timeline while capping the drawer at 80 percent", () => {
    expect(resolveWorkspaceCardDrawerHeightBounds(620)).toEqual({ min: 320, max: 460 });
    expect(resolveWorkspaceCardDrawerHeightBounds(1_400)).toEqual({ min: 320, max: 1_120 });
  });

  it("uses the proportional default only for manually resizable drawers", () => {
    expect(resolveWorkspaceCardDrawerHeight({ availableHeight: 1_400 })).toBe(868);
    expect(resolveWorkspaceCardDrawerHeight({ availableHeight: 1_400, requestedHeight: 900 })).toBe(
      900,
    );
  });
});

describe("workspace card roles", () => {
  it("places Example above and Git below Chat in canonical order", () => {
    expect(resolveWorkspaceDeckRoles(repositoryCards, "chat")).toEqual([
      { id: "chat", position: "active" },
      { id: "git", position: "next" },
      { id: "example", position: "previous" },
    ]);
  });

  it("rotates previous and next cards around every active card", () => {
    expect(resolveWorkspaceDeckRoles(repositoryCards, "git")).toEqual([
      { id: "chat", position: "previous" },
      { id: "git", position: "active" },
      { id: "example", position: "next" },
    ]);
    expect(resolveWorkspaceDeckRoles(repositoryCards, "example")).toEqual([
      { id: "chat", position: "next" },
      { id: "git", position: "previous" },
      { id: "example", position: "active" },
    ]);
  });

  it("shows one alternating peek when only two cards are registered", () => {
    const cards = ["chat", "example"] as const;

    expect(resolveWorkspaceDeckRoles(cards, "chat")).toEqual([
      { id: "chat", position: "active" },
      { id: "example", position: "previous" },
    ]);
    expect(resolveWorkspaceDeckRoles(cards, "example")).toEqual([
      { id: "chat", position: "next" },
      { id: "example", position: "active" },
    ]);
  });

  it("keeps non-adjacent cards mounted but hidden", () => {
    expect(resolveWorkspaceDeckRoles(["chat", "git", "example", "files"], "chat")).toEqual([
      { id: "chat", position: "active" },
      { id: "git", position: "next" },
      { id: "example", position: "hidden" },
      { id: "files", position: "previous" },
    ]);
  });

  it("reports duplicate card IDs so the renderer can fail early", () => {
    expect(findDuplicateWorkspaceDeckCardId(["chat", "git", "chat"])).toBe("chat");
    expect(findDuplicateWorkspaceDeckCardId(repositoryCards)).toBeNull();
  });
});

describe("workspace card selection", () => {
  it("resolves direction from the exposed previous and next positions", () => {
    expect(resolveWorkspaceDeckDirection(repositoryCards, "chat", "git")).toBe("forward");
    expect(resolveWorkspaceDeckDirection(repositoryCards, "chat", "example")).toBe("backward");
    expect(resolveWorkspaceDeckDirection(repositoryCards, "chat", "chat")).toBeNull();
  });

  it("keeps the two-card motion alternating between upper and lower peeks", () => {
    const cards = ["chat", "example"] as const;

    expect(resolveWorkspaceDeckDirection(cards, "chat", "example")).toBe("backward");
    expect(resolveWorkspaceDeckDirection(cards, "example", "chat")).toBe("forward");
  });

  it("selects the shorter circular route for a non-adjacent request", () => {
    const cards = ["one", "two", "three", "four", "five"] as const;

    expect(resolveWorkspaceDeckDirection(cards, "one", "three")).toBe("forward");
    expect(resolveWorkspaceDeckDirection(cards, "one", "four")).toBe("backward");
  });

  it("preserves a valid selection when Git becomes available", () => {
    expect(
      resolveWorkspaceDeckActiveCard({
        cardIds: repositoryCards,
        activeCard: "example",
        fallbackCard: "chat",
      }),
    ).toBe("example");
  });

  it("returns to Chat when a dynamically removed Git card was active", () => {
    expect(
      resolveWorkspaceDeckActiveCard({
        cardIds: ["chat", "example"] as const,
        activeCard: "git",
        fallbackCard: "chat",
      }),
    ).toBe("chat");
  });

  it("uses the first available card when the preferred fallback is unavailable", () => {
    expect(
      resolveWorkspaceDeckActiveCard({
        cardIds: ["example"] as const,
        activeCard: "missing",
        fallbackCard: "chat",
      }),
    ).toBe("example");
    expect(
      resolveWorkspaceDeckActiveCard({
        cardIds: [] as const,
        activeCard: "missing",
        fallbackCard: "chat",
      }),
    ).toBeNull();
  });

  it("treats selecting the active card as a no-op", () => {
    expect(
      resolveWorkspaceDeckSelection({
        cardIds: repositoryCards,
        activeCard: "chat",
        requestedCard: "chat",
        transitionActive: false,
      }),
    ).toEqual({
      activeCard: "chat",
      cancelTransition: false,
      changed: false,
      direction: null,
      selectionMode: null,
    });
  });

  it("locks normal selection while a shuffle is active", () => {
    expect(
      resolveWorkspaceDeckSelection({
        cardIds: repositoryCards,
        activeCard: "git",
        requestedCard: "example",
        transitionActive: true,
      }),
    ).toEqual({
      activeCard: "git",
      cancelTransition: false,
      changed: false,
      direction: null,
      selectionMode: null,
    });
  });

  it("lets a priority Chat promotion cancel a shuffle and select immediately", () => {
    expect(
      resolveWorkspaceDeckSelection({
        cardIds: repositoryCards,
        activeCard: "example",
        requestedCard: "chat",
        transitionActive: true,
        priority: true,
      }),
    ).toEqual({
      activeCard: "chat",
      cancelTransition: true,
      changed: true,
      direction: null,
      selectionMode: "immediate",
    });
  });

  it("rejects requests for cards that are no longer registered", () => {
    expect(
      resolveWorkspaceDeckSelection({
        cardIds: ["chat", "example"] as const,
        activeCard: "chat",
        requestedCard: "git",
        transitionActive: false,
      }),
    ).toEqual({
      activeCard: "chat",
      cancelTransition: false,
      changed: false,
      direction: null,
      selectionMode: null,
    });
  });
});

describe("workspace compact card measurements", () => {
  it("uses the active natural height until the Chat reference is measured", () => {
    expect(
      resolveWorkspaceDeckCompactHeight({
        activeCard: "git",
        cardIds: repositoryCards,
        referenceCard: "chat",
        measurements: { git: 224, example: 196 },
      }),
    ).toBe(224);
  });

  it("uses Chat as the compact height even when another card is taller", () => {
    expect(
      resolveWorkspaceDeckCompactHeight({
        activeCard: "git",
        cardIds: repositoryCards,
        referenceCard: "chat",
        measurements: { chat: 180, git: 224, example: 196 },
      }),
    ).toBe(180);
  });

  it("ignores later Git and Example height changes", () => {
    expect(
      resolveWorkspaceDeckCompactHeight({
        activeCard: "example",
        cardIds: repositoryCards,
        referenceCard: "chat",
        measurements: { chat: 180, git: 320, example: 96 },
      }),
    ).toBe(180);
  });

  it("freezes a valid height for the duration of a shuffle", () => {
    expect(
      resolveWorkspaceDeckCompactHeight({
        activeCard: "git",
        cardIds: repositoryCards,
        frozenHeight: 224,
        referenceCard: "chat",
        measurements: { chat: 260, git: 224, example: 196 },
      }),
    ).toBe(224);
  });

  it("drops measurements for cards removed from the descriptor list", () => {
    expect(
      pruneWorkspaceDeckMeasurements(["chat", "example"] as const, {
        chat: 180,
        git: 224,
        example: 196,
      }),
    ).toEqual({ chat: 180, example: 196 });
  });
});
