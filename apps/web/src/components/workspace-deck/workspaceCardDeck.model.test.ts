import { describe, expect, it, vi } from "vite-plus/test";

import type { WorkspaceDeckCardDefinition } from "./WorkspaceCardDeck";
import { prepareWorkspaceCardDeckView } from "./workspaceCardDeck.model";

function card(id: string): WorkspaceDeckCardDefinition<string> {
  return {
    id,
    label: id,
    renderBody: vi.fn(() => null),
    renderPeek: vi.fn(() => null),
  };
}

describe("prepareWorkspaceCardDeckView", () => {
  it("materializes one heavy body and at most two lightweight peeks for 160 cards", () => {
    const cards = Array.from({ length: 160 }, (_, index) => card(`card-${index}`));

    const view = prepareWorkspaceCardDeckView({
      activeCard: "card-80",
      cards,
      compactHeightReferenceCard: "card-0",
    });

    expect(view.activeCardDefinition.id).toBe("card-80");
    expect(view.peekCards).toHaveLength(2);
    expect(view.peekCards.map(({ card: definition }) => definition.id)).toEqual([
      "card-79",
      "card-81",
    ]);
    expect(
      cards.every((definition) => vi.mocked(definition.renderBody).mock.calls.length === 0),
    ).toBe(true);
  });

  it("falls back to the first available card when remote state names a removed card", () => {
    const view = prepareWorkspaceCardDeckView({
      activeCard: "removed",
      cards: [card("chat"), card("files")],
      compactHeightReferenceCard: "removed",
    });

    expect(view.activeCard).toBe("chat");
    expect(view.compactHeightReferenceCard).toBe("chat");
  });

  it("rejects duplicate identifiers before rendering any body", () => {
    const duplicate = card("chat");
    expect(() =>
      prepareWorkspaceCardDeckView({
        activeCard: "chat",
        cards: [duplicate, card("chat")],
        compactHeightReferenceCard: "chat",
      }),
    ).toThrow(/duplicate workspace card id/i);
    expect(duplicate.renderBody).not.toHaveBeenCalled();
  });
});
