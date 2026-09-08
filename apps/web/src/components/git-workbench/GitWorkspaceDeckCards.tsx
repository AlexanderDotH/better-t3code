import { MessageSquareIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import {
  McpWorkspaceCardController,
  McpWorkspacePeekController,
} from "../mcp-workspace/McpWorkspaceController";
import type { WorkspaceDeckCardDefinition } from "../workspace-deck/WorkspaceCardDeck";
import { WorkspaceCardPeek } from "../workspace-deck/WorkspaceCardPeek";
import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import type { GitCompactStatus } from "./GitCompactCard";
import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";

type CardControllerProps = Pick<
  GitWorkspaceDeckControllerProps,
  | "cwd"
  | "drawerAvailableHeight"
  | "environmentId"
  | "mcpAuthorizationAvailable"
  | "mcpConfiguredServers"
  | "mcpProviderAccentColor"
  | "mcpProviderDisplayName"
  | "mcpProviderDriver"
  | "mcpProviderInstanceId"
  | "mcpProviders"
  | "mcpRuntimeSessionId"
  | "mcpWorkspaceSupported"
  | "renderChat"
  | "renderGitPeek"
  | "threadId"
>;

export interface UseGitWorkspaceDeckCardsInput {
  readonly controller: CardControllerProps;
  readonly gitAvailable: boolean;
  readonly gitCard: ReactNode;
  readonly mcpExpanded: boolean;
  readonly selectionBlocked: boolean;
  readonly status: GitCompactStatus;
  readonly onExpandedCardChange: (card: ChatWorkspaceCardId | null) => void;
  readonly selectCard: (card: ChatWorkspaceCardId) => void;
}

export function useGitWorkspaceDeckCards(
  input: UseGitWorkspaceDeckCardsInput,
): readonly WorkspaceDeckCardDefinition<ChatWorkspaceCardId>[] {
  const { controller } = input;
  const translate = useInterfaceTranslator().message;
  return useMemo(() => {
    const chatCard: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "chat",
      label: translate("git.cards.chatWorkspace"),
      renderBody: () =>
        controller.renderChat({
          deckEnabled: true,
          gitAvailable: input.gitAvailable,
        }),
      renderPeek: ({ blocked, position, requestActivation }) => (
        <WorkspaceCardPeek
          blocked={blocked}
          cardId="chat"
          label={translate("git.cards.chatWorkspace")}
          position={position}
          onActivate={requestActivation}
        >
          <span
            className="flex h-full items-center gap-1.5 !px-7 text-xs font-medium text-muted-foreground"
            data-workspace-card-peek-id="chat"
          >
            <MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />
            <span>{translate("git.cards.chat")}</span>
          </span>
        </WorkspaceCardPeek>
      ),
    };
    const mcpCard: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "mcp",
      label: translate("git.cards.mcpWorkspace"),
      renderBody: ({ active }) => (
        <McpWorkspaceCardController
          active={active}
          authorizationAvailable={controller.mcpAuthorizationAvailable}
          configuredServers={controller.mcpConfiguredServers}
          environmentId={controller.environmentId}
          expanded={input.mcpExpanded}
          expansionBlocked={input.selectionBlocked}
          projectCwd={controller.cwd}
          providerDisplayName={controller.mcpProviderDisplayName}
          providerDriver={controller.mcpProviderDriver}
          providerInstanceId={controller.mcpProviderInstanceId}
          providers={controller.mcpProviders}
          runtimeSessionId={controller.mcpRuntimeSessionId}
          threadId={controller.threadId}
          workspaceSupported={controller.mcpWorkspaceSupported}
          {...(controller.mcpProviderAccentColor === undefined
            ? {}
            : { providerAccentColor: controller.mcpProviderAccentColor })}
          {...(controller.drawerAvailableHeight === undefined
            ? {}
            : { drawerAvailableHeight: controller.drawerAvailableHeight })}
          onExpandedChange={(expanded) => {
            if (input.selectionBlocked && expanded) return;
            if (expanded) input.selectCard("mcp");
            input.onExpandedCardChange(expanded ? "mcp" : null);
          }}
        />
      ),
      renderPeek: ({ blocked, position, requestActivation }) => (
        <McpWorkspacePeekController
          blocked={blocked || input.selectionBlocked}
          configuredServers={controller.mcpConfiguredServers}
          environmentId={controller.environmentId}
          position={position}
          projectCwd={controller.cwd}
          providerDisplayName={controller.mcpProviderDisplayName}
          providerInstanceId={controller.mcpProviderInstanceId}
          runtimeSessionId={controller.mcpRuntimeSessionId}
          threadId={controller.threadId}
          workspaceSupported={controller.mcpWorkspaceSupported}
          requestActivation={requestActivation}
        />
      ),
    };
    if (!input.gitAvailable) return [chatCard, mcpCard];

    const gitCard: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "git",
      label: translate("git.cards.gitWorkspace"),
      renderBody: () => input.gitCard,
      renderPeek: ({ blocked, position, requestActivation }) => (
        <WorkspaceCardPeek
          blocked={blocked}
          cardId="git"
          label={translate("git.cards.gitWorkspace")}
          position={position}
          onActivate={requestActivation}
        >
          {controller.renderGitPeek({
            blocked: blocked || input.selectionBlocked,
            position,
            status: input.status,
          })}
        </WorkspaceCardPeek>
      ),
    };
    return [chatCard, gitCard, mcpCard];
  }, [
    controller,
    input.gitAvailable,
    input.gitCard,
    input.mcpExpanded,
    input.onExpandedCardChange,
    input.selectCard,
    input.selectionBlocked,
    input.status,
    translate,
  ]);
}
