import { ProviderDriverKind } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ChatWorkspaceDeck, resolveChatWorkspaceCardRequest } from "./ChatWorkspaceDeck";
import { McpWorkspaceCard } from "../mcp-workspace/McpWorkspaceCard";
import { McpWorkspacePeek } from "../mcp-workspace/McpWorkspacePeek";
import { type WorkspaceDeckCardDefinition } from "../workspace-deck/WorkspaceCardDeck";
import { WorkspaceCardPeek } from "../workspace-deck/WorkspaceCardPeek";
import { GitCompactCard } from "./GitCompactCard";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";

type CardId = "chat" | "git" | "mcp";

const mcpSummary = {
  attentionCount: 0,
  configuredCount: 2,
  connectedCount: 2,
  expectedCount: 2,
  freshnessLabel: "Observed just now",
  state: "live" as const,
  statusLabel: "2 of 2 connected",
  toolCount: 8,
};

function card(id: CardId): WorkspaceDeckCardDefinition<CardId> {
  return {
    id,
    label: `${id} workspace`,
    renderBody: () =>
      id === "mcp" ? (
        <McpWorkspaceCard
          providerDisplayName="Codex Work"
          providerDriver={ProviderDriverKind.make("codex")}
          summary={mcpSummary}
          onExpand={vi.fn()}
        />
      ) : (
        <div>{id} body remains mounted</div>
      ),
    renderPeek: ({ blocked, position, requestActivation }) =>
      id === "mcp" ? (
        <McpWorkspacePeek
          blocked={blocked}
          position={position}
          providerDisplayName="Codex Work"
          summary={mcpSummary}
          requestActivation={requestActivation}
        />
      ) : (
        <WorkspaceCardPeek
          blocked={blocked}
          cardId={id}
          label={`${id} workspace`}
          position={position}
          onActivate={requestActivation}
        >
          {id} peek
        </WorkspaceCardPeek>
      ),
  };
}

const workspaceCards = [card("chat"), card("git"), card("mcp")] as const;

const compactStatus = {
  kind: "changed" as const,
  label: "Changes present",
  branch: "main",
  changeCount: 6,
  staged: 2,
  unstaged: 3,
  untracked: 1,
  conflicts: 0,
  additions: 42,
  deletions: 7,
  ahead: 1,
  behind: 2,
  updatedAtLabel: "Updated just now",
};

describe("ChatWorkspaceDeck", () => {
  it.each(["git", "mcp"] as const)(
    "blocks leaving Chat for %s while voice recording is active",
    (requestedCard) => {
      expect(
        resolveChatWorkspaceCardRequest({
          actionRequired: false,
          activeCard: "chat",
          expandedCard: null,
          isRecording: true,
          requestedCard,
        }),
      ).toEqual({
        blockedReason: "recording",
        nextCard: "chat",
        shouldCollapseExpandedCard: false,
        shouldDismissChatUi: false,
      });
    },
  );

  it("blocks leaving Chat while an agent action requires attention", () => {
    expect(
      resolveChatWorkspaceCardRequest({
        actionRequired: true,
        activeCard: "chat",
        expandedCard: null,
        isRecording: false,
        requestedCard: "mcp",
      }),
    ).toEqual({
      blockedReason: "action-required",
      nextCard: "chat",
      shouldCollapseExpandedCard: false,
      shouldDismissChatUi: false,
    });
  });

  it("dismisses transient Chat UI on departure and collapses expanded Git on departure", () => {
    expect(
      resolveChatWorkspaceCardRequest({
        actionRequired: false,
        activeCard: "chat",
        expandedCard: null,
        isRecording: false,
        requestedCard: "mcp",
      }),
    ).toMatchObject({
      blockedReason: null,
      nextCard: "mcp",
      shouldDismissChatUi: true,
    });
    expect(
      resolveChatWorkspaceCardRequest({
        actionRequired: false,
        activeCard: "git",
        expandedCard: "git",
        isRecording: false,
        requestedCard: "chat",
      }),
    ).toMatchObject({
      blockedReason: null,
      nextCard: "chat",
      shouldCollapseExpandedCard: true,
    });
  });

  it("defers leaving any expanded non-Chat card", () => {
    expect(
      resolveChatWorkspaceCardRequest({
        actionRequired: false,
        activeCard: "mcp",
        expandedCard: "mcp",
        isRecording: false,
        requestedCard: "git",
      }),
    ).toMatchObject({
      blockedReason: null,
      nextCard: "git",
      shouldCollapseExpandedCard: true,
    });
  });

  it("keeps Chat mounted but inert and hidden when Git is in front", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDeck
        activeCard="git"
        actionRequired={false}
        cards={workspaceCards}
        expandedCard={null}
        isRecording={false}
        resetKey="environment:cwd:thread"
        onActiveCardChange={vi.fn()}
        onExpandedCardChange={vi.fn()}
      />,
    );

    expect(html).toContain("chat body remains mounted");
    expect(html).toContain('data-workspace-card-body="chat"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
    expect(html).toContain('data-workspace-card-body="git"');
  });

  it("renders the ordered Chat, Git, and MCP bodies through the generic deck", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDeck
        activeCard="chat"
        actionRequired={false}
        cards={workspaceCards}
        expandedCard={null}
        isRecording={false}
        resetKey="environment:cwd:thread"
        onActiveCardChange={vi.fn()}
        onExpandedCardChange={vi.fn()}
      />,
    );

    expect(html.match(/data-workspace-card-body=/g)).toHaveLength(3);
    expect(html).toContain('data-workspace-card-body="chat"');
    expect(html).toContain('data-workspace-card-body="git"');
    expect(html).toContain('data-workspace-card-body="mcp"');
    expect(html).toContain('data-mcp-workspace-card="true"');
    expect(html.match(/data-workspace-card-peek-trigger="true"/g)).toHaveLength(2);
  });

  it("promotes Chat immediately when action is required", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDeck
        activeCard="mcp"
        actionRequired
        cards={workspaceCards}
        expandedCard={null}
        isRecording={false}
        resetKey="environment:cwd:thread"
        onActiveCardChange={vi.fn()}
        onExpandedCardChange={vi.fn()}
      />,
    );

    expect(html).toContain('data-chat-workspace-deck="true" data-active-card="chat"');
    expect(html).toContain('data-workspace-card-body="chat" data-card-position="active"');
  });

  it("falls back to Chat immediately when the active Git descriptor disappears", () => {
    const html = renderToStaticMarkup(
      <ChatWorkspaceDeck
        activeCard="git"
        actionRequired={false}
        cards={[card("chat"), card("mcp")]}
        expandedCard={null}
        isRecording={false}
        resetKey="environment:cwd:thread"
        onActiveCardChange={vi.fn()}
        onExpandedCardChange={vi.fn()}
      />,
    );

    expect(html).toContain('data-chat-workspace-deck="true" data-active-card="chat"');
    expect(html.match(/data-workspace-card-peek=/g)).toHaveLength(1);
  });
});

describe("McpWorkspaceCard in the Chat deck", () => {
  it("renders the production MCP body and accessible peek", () => {
    const body = renderToStaticMarkup(
      <McpWorkspaceCard
        providerDisplayName="Codex Work"
        providerDriver={ProviderDriverKind.make("codex")}
        summary={mcpSummary}
        onExpand={vi.fn()}
      />,
    );
    const peek = renderToStaticMarkup(
      <McpWorkspacePeek
        blocked={false}
        position="previous"
        providerDisplayName="Codex Work"
        summary={mcpSummary}
        requestActivation={vi.fn()}
      />,
    );

    expect(body).toContain('data-mcp-workspace-card="true"');
    expect(peek).toContain('aria-label="Open MCP workspace"');
    expect(peek).toContain('data-workspace-card-peek-id="mcp"');
  });
});

describe("GitCompactCard", () => {
  it("renders observable repository facts without a synthetic health score", () => {
    const html = renderToStaticMarkup(
      <GitCompactCard
        status={compactStatus}
        lastCommit={{ summary: "feat: add workspace deck", ageLabel: "12 minutes ago" }}
        quickAction={{ label: "Commit staged", onSelect: vi.fn() }}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain("Changes present");
    expect(html).toContain("6 changes");
    expect(html).toContain("2 staged");
    expect(html).toContain("3 unstaged");
    expect(html).toContain("1 untracked");
    expect(html).toContain("0 conflicts");
    expect(html).toContain("+42");
    expect(html).toContain("−7");
    expect(html).toContain("feat: add workspace deck");
    expect(html).toContain("Commit staged");
    expect(html).toContain('data-workspace-card-compact-surface="true"');
    expect(html).toContain(
      'class="workspace-card-deck__card-content git-compact-card__content" data-workspace-card-compact-content="true"',
    );
    expect(html).not.toContain("Recent activity");
    expect(html).not.toContain("Top contributors");
    expect(html).not.toContain("Code mix");
    expect(html).not.toContain("Health");
  });

  it("leaves card navigation to the exposed deck peeks", () => {
    const html = renderToStaticMarkup(<GitCompactCard status={compactStatus} onExpand={vi.fn()} />);

    expect(html).not.toContain('aria-label="Return to chat"');
    expect(html).toContain('aria-label="Expand Git workbench"');
    expect(html).toContain('data-git-compact-pull-handle="true"');
  });

  it("contains the expanded workbench inside the same Git card", () => {
    const html = renderToStaticMarkup(
      <GitCompactCard
        expanded
        status={compactStatus}
        workbench={
          <GitWorkbenchDrawerShell
            open
            activeTab="overview"
            className="workspace-card-deck__card-content git-workbench-drawer--embedded"
            onActiveTabChange={vi.fn()}
            onOpenChange={vi.fn()}
          >
            <div>Embedded repository workbench</div>
          </GitWorkbenchDrawerShell>
        }
        onExpand={vi.fn()}
      />,
    );

    const cardStart = html.indexOf("<article");
    const drawerStart = html.indexOf('data-git-workbench-drawer="true"');
    const cardEnd = html.indexOf("</article>", cardStart);

    expect(html).toContain('data-expanded="true"');
    expect(html).toContain("Embedded repository workbench");
    expect(html).toContain(
      'class="workspace-card-deck__card-content git-compact-card__content" data-workspace-card-compact-content="true" hidden=""',
    );
    expect(drawerStart).toBeGreaterThan(cardStart);
    expect(drawerStart).toBeLessThan(cardEnd);
  });
});

describe("GitWorkbenchDrawerShell", () => {
  it("renders the five-tab workbench at its clamped default height", () => {
    const html = renderToStaticMarkup(
      <GitWorkbenchDrawerShell
        open
        availableHeight={620}
        activeTab="overview"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Repository pulse</div>
      </GitWorkbenchDrawerShell>,
    );

    expect(html).toContain("--git-workbench-drawer-height:384px");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Resize Git workbench vertically"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("Overview");
    expect(html).toContain("Changes");
    expect(html).toContain("History");
    expect(html).toContain("Branches");
    expect(html).toContain("Operations");
    expect(html).toContain("Repository pulse");
  });

  it("does not mount drawer contents while collapsed", () => {
    const html = renderToStaticMarkup(
      <GitWorkbenchDrawerShell
        open={false}
        activeTab="overview"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Repository pulse</div>
      </GitWorkbenchDrawerShell>,
    );

    expect(html).toBe("");
  });

  it("omits Operations until there is an operation to show", () => {
    const html = renderToStaticMarkup(
      <GitWorkbenchDrawerShell
        open
        showOperationsTab={false}
        activeTab="overview"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Repository pulse</div>
      </GitWorkbenchDrawerShell>,
    );

    expect(html).not.toContain(">Operations</button>");
  });

  it("can delegate tab rendering to an embedded workbench panel", () => {
    const html = renderToStaticMarkup(
      <GitWorkbenchDrawerShell
        open
        showTabs={false}
        activeTab="overview"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Panel-owned tabs</div>
      </GitWorkbenchDrawerShell>,
    );

    expect(html).not.toContain('role="tablist"');
    expect(html).toContain("Panel-owned tabs");
  });
});
