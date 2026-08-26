import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { WorkspaceCardDeck, type WorkspaceDeckCardDefinition } from "./WorkspaceCardDeck";
import { WorkspaceCardPeek } from "./WorkspaceCardPeek";

type TestCardId = "chat" | "git" | "example";

function createCard(id: TestCardId): WorkspaceDeckCardDefinition<TestCardId> {
  return {
    id,
    label: `${id} card`,
    renderBody: ({ active, expanded }) => (
      <div data-card-body-content={id} data-active={active} data-expanded={expanded}>
        {id} body
      </div>
    ),
    renderPeek: ({ position, blocked, requestActivation }) => (
      <WorkspaceCardPeek
        cardId={id}
        label={`${id} card`}
        position={position}
        blocked={blocked}
        onActivate={requestActivation}
      >
        {id} peek
      </WorkspaceCardPeek>
    ),
  };
}

const cards = [createCard("chat"), createCard("git"), createCard("example")] as const;

describe("WorkspaceCardDeck", () => {
  it("keeps every registered body mounted while exposing only the active card", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDeck
        activeCard="chat"
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard={null}
        resetKey="environment:cwd:thread"
        selectionMode="animate"
        onRequestCard={vi.fn()}
      />,
    );

    expect(html.match(/data-workspace-card-body=/g)).toHaveLength(3);
    expect(html.match(/data-workspace-card-morph-host=/g)).toHaveLength(3);
    expect(html).toMatch(
      /<section[^>]*data-workspace-card-body="chat"[^>]*data-card-position="active"[^>]*aria-label="chat card"[^>]*>/,
    );
    expect(html).toMatch(
      /data-workspace-card-morph-host="chat"[^>]*aria-hidden="true"[^>]*inert=""/,
    );
    expect(html).toMatch(
      /<section[^>]*data-workspace-card-body="git"[^>]*data-card-position="next"[^>]*aria-hidden="true"[^>]*inert=""/,
    );
    expect(html).toMatch(
      /<section[^>]*data-workspace-card-body="example"[^>]*data-card-position="previous"[^>]*aria-hidden="true"[^>]*inert=""/,
    );
  });

  it("renders previous and next peeks after the inert body stack", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDeck
        activeCard="git"
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard={null}
        resetKey="environment:cwd:thread"
        selectionMode="animate"
        onRequestCard={vi.fn()}
      />,
    );

    expect(html.match(/data-workspace-card-peek=/g)).toHaveLength(2);
    expect(html).toContain('data-workspace-card-peek="chat"');
    expect(html).toContain('data-peek-position="previous"');
    expect(html).toContain('data-workspace-card-peek="example"');
    expect(html).toContain('data-peek-position="next"');
    expect(html.indexOf("data-workspace-card-peeks")).toBeGreaterThan(
      html.lastIndexOf("</section>"),
    );
  });

  it("renders one exposed edge for a two-card deck", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDeck
        activeCard="chat"
        cards={[createCard("chat"), createCard("example")]}
        compactHeightReferenceCard="chat"
        expandedCard={null}
        resetKey="environment:cwd:thread"
        selectionMode="animate"
        onRequestCard={vi.fn()}
      />,
    );

    expect(html.match(/data-workspace-card-peek=/g)).toHaveLength(1);
    expect(html).toContain('data-workspace-card-peek="example"');
    expect(html).toContain('data-peek-position="previous"');
  });

  it("passes active and expanded state to each mounted body", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDeck
        activeCard="git"
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard="git"
        resetKey="environment:cwd:thread"
        selectionMode="animate"
        onRequestCard={vi.fn()}
      />,
    );

    expect(html).toContain('data-card-body-content="git" data-active="true" data-expanded="true"');
    expect(html).toContain(
      'data-card-body-content="chat" data-active="false" data-expanded="false"',
    );
    expect(html).toContain('data-expanded-card="git"');
  });

  it("rejects duplicate card identifiers", () => {
    expect(() =>
      renderToStaticMarkup(
        <WorkspaceCardDeck
          activeCard="chat"
          cards={[createCard("chat"), createCard("chat")]}
          compactHeightReferenceCard="chat"
          expandedCard={null}
          resetKey="environment:cwd:thread"
          selectionMode="animate"
          onRequestCard={vi.fn()}
        />,
      ),
    ).toThrow(/duplicate workspace card id/i);
  });

  it("supports an expanded Example card without unmounting its neighbors", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDeck
        activeCard="example"
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard="example"
        resetKey="environment:cwd:thread"
        selectionMode="animate"
        onRequestCard={vi.fn()}
      />,
    );

    expect(html).toContain('data-expanded-card="example"');
    expect(html.match(/data-workspace-card-body=/g)).toHaveLength(3);
    expect(html.match(/data-workspace-card-peek=/g)).toHaveLength(2);
  });
});

describe("WorkspaceCardPeek", () => {
  it("provides one keyboard-accessible button across the plain peek surface", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardPeek
        cardId="example"
        label="Example card"
        position="next"
        blocked={false}
        onActivate={vi.fn()}
      >
        Animation preview
      </WorkspaceCardPeek>,
    );

    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open Example card"');
    expect(html).toContain('data-workspace-card-peek-trigger="true"');
    expect(html).toContain("Animation preview");
  });

  it("keeps a blocked peek discoverable without allowing activation", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardPeek
        cardId="git"
        label="Git card"
        position="previous"
        blocked
        onActivate={vi.fn()}
      >
        Git status
      </WorkspaceCardPeek>,
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-blocked="true"');
  });
});
