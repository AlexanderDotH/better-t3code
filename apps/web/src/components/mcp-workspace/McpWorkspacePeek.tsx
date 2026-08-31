import type { WorkspaceDeckPosition } from "../workspace-deck/workspaceCardDeck.logic";
import { WorkspaceCardPeek } from "../workspace-deck/WorkspaceCardPeek";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { McpWorkspaceSummary } from "./mcpWorkspace.logic";

export interface McpWorkspacePeekProps {
  readonly blocked: boolean;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
  readonly providerDisplayName: string;
  readonly summary: McpWorkspaceSummary;
  readonly requestActivation: () => void;
}

function peekStatus(
  summary: McpWorkspaceSummary,
  translate: ReturnType<typeof useInterfaceTranslator>["message"],
): string {
  if (summary.attentionCount > 0) {
    return translate("settings.mcp.workspace.needsAttention", { count: summary.attentionCount });
  }
  return summary.statusLabel;
}

export function McpWorkspacePeek(props: McpWorkspacePeekProps) {
  const translate = useInterfaceTranslator().message;
  return (
    <WorkspaceCardPeek
      blocked={props.blocked}
      cardId="mcp"
      className="mcp-workspace-peek"
      label={translate("settings.mcp.workspace.title")}
      position={props.position}
      onActivate={props.requestActivation}
    >
      <span className="mcp-workspace-peek__content" data-workspace-card-peek-id="mcp">
        <strong>MCP</strong>
        <span className="mcp-workspace-peek__provider">{props.providerDisplayName}</span>
        <span className="mcp-workspace-peek__status" data-mcp-workspace-state={props.summary.state}>
          {peekStatus(props.summary, translate)}
        </span>
      </span>
    </WorkspaceCardPeek>
  );
}
