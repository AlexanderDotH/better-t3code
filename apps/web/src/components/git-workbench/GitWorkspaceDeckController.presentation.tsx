import type { ComponentProps, ReactNode, RefObject } from "react";

import { McpWorkspaceRuntimeProvider } from "../mcp-workspace/McpWorkspaceController";
import { ChatWorkspaceDeck, type ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import { GitCompactCard, type GitCompactStatus } from "./GitCompactCard";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";
import type { GitWorkbenchTabId } from "./GitWorkbench.types";
import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";

export function GitWorkspaceDeckGitCard(props: {
  readonly activeTab: GitWorkbenchTabId;
  readonly availableHeight?: number | undefined;
  readonly blocked: boolean;
  readonly expanded: boolean;
  readonly expandButtonRef: RefObject<HTMLButtonElement | null>;
  readonly lastCommit: Exclude<ComponentProps<typeof GitCompactCard>["lastCommit"], undefined>;
  readonly onActiveTabChange: (tab: GitWorkbenchTabId) => void;
  readonly onExpand: () => void;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly panel: ReactNode;
  readonly quickAction: Exclude<ComponentProps<typeof GitCompactCard>["quickAction"], undefined>;
  readonly repositoryLabel: string;
  readonly showOperationsTab: boolean;
  readonly status: GitCompactStatus;
}) {
  return (
    <GitCompactCard
      expanded={props.expanded}
      expansionBlocked={props.blocked}
      expandButtonRef={props.expandButtonRef}
      lastCommit={props.lastCommit}
      onExpand={props.onExpand}
      quickAction={props.quickAction}
      status={props.status}
      workbench={
        <GitWorkbenchDrawerShell
          activeTab={props.activeTab}
          className="workspace-card-deck__card-content git-workbench-drawer--embedded"
          {...(props.availableHeight === undefined
            ? {}
            : { availableHeight: props.availableHeight })}
          onActiveTabChange={props.onActiveTabChange}
          onOpenChange={props.onExpandedChange}
          open={props.expanded}
          repositoryLabel={props.repositoryLabel}
          returnFocusRef={props.expandButtonRef}
          showOperationsTab={props.showOperationsTab}
        >
          {props.panel}
        </GitWorkbenchDrawerShell>
      }
    />
  );
}

type McpRuntimePresentationProps = Pick<
  GitWorkspaceDeckControllerProps,
  | "cwd"
  | "environmentId"
  | "mcpProviderInstanceId"
  | "mcpProviders"
  | "mcpRuntimeSessionId"
  | "mcpWorkspaceSupported"
  | "threadId"
>;

export interface GitWorkspaceDeckPresentationProps {
  readonly actionRequired: boolean;
  readonly activeCard: ChatWorkspaceCardId;
  readonly cards: ComponentProps<typeof ChatWorkspaceDeck>["cards"];
  readonly deckEnabled: boolean;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly fallback: ReactNode;
  readonly isRecording: boolean;
  readonly isDesktop: boolean;
  readonly mcpExpanded: boolean;
  readonly mcpRuntime: McpRuntimePresentationProps;
  readonly onActiveCardChange: (card: ChatWorkspaceCardId) => void;
  readonly onBeforeHideChat: () => void;
  readonly onCardSelectionBlocked: NonNullable<
    ComponentProps<typeof ChatWorkspaceDeck>["onCardSelectionBlocked"]
  >;
  readonly onExpandedCardChange: (card: ChatWorkspaceCardId | null) => void;
  readonly onRestoreChatFocus: () => void;
  readonly resetKey: string;
}

export function GitWorkspaceDeckPresentation(props: GitWorkspaceDeckPresentationProps) {
  if (!props.isDesktop || !props.deckEnabled) {
    return props.fallback;
  }

  return (
    <McpWorkspaceRuntimeProvider
      environmentId={props.mcpRuntime.environmentId}
      active={props.activeCard === "mcp"}
      expanded={props.mcpExpanded}
      projectCwd={props.mcpRuntime.cwd}
      providerInstanceId={props.mcpRuntime.mcpProviderInstanceId}
      providers={props.mcpRuntime.mcpProviders}
      runtimeSessionId={props.mcpRuntime.mcpRuntimeSessionId}
      threadId={props.mcpRuntime.threadId}
      workspaceSupported={props.mcpRuntime.mcpWorkspaceSupported}
    >
      <ChatWorkspaceDeck
        actionRequired={props.actionRequired}
        activeCard={props.activeCard}
        cards={props.cards}
        expandedCard={props.expandedCard}
        isRecording={props.isRecording}
        resetKey={props.resetKey}
        onActiveCardChange={props.onActiveCardChange}
        onBeforeHideChat={props.onBeforeHideChat}
        onCardSelectionBlocked={props.onCardSelectionBlocked}
        onExpandedCardChange={props.onExpandedCardChange}
        onRestoreChatFocus={props.onRestoreChatFocus}
      />
    </McpWorkspaceRuntimeProvider>
  );
}
