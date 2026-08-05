import type { WorkspaceDeckPosition } from "../workspace-deck/workspaceCardDeck.logic";
import { WorkspaceCardPeek } from "../workspace-deck/WorkspaceCardPeek";
import type { McpWorkspaceSummary } from "./mcpWorkspace.logic";

export interface McpWorkspacePeekProps {
  readonly blocked: boolean;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
  readonly providerDisplayName: string;
  readonly summary: McpWorkspaceSummary;
  readonly requestActivation: () => void;
}

function peekStatus(summary: McpWorkspaceSummary): string {
  if (summary.attentionCount > 0) {
    return `${summary.attentionCount} needs attention`;
  }
  return summary.statusLabel;
}

export function McpWorkspacePeek(props: McpWorkspacePeekProps) {
  return (
    <WorkspaceCardPeek
      blocked={props.blocked}
      cardId="mcp"
      className="mcp-workspace-peek"
      label="MCP workspace"
      position={props.position}
      onActivate={props.requestActivation}
    >
      <span className="mcp-workspace-peek__content" data-workspace-card-peek-id="mcp">
        <strong>MCP</strong>
        <span className="mcp-workspace-peek__provider">{props.providerDisplayName}</span>
        <span className="mcp-workspace-peek__status" data-mcp-workspace-state={props.summary.state}>
          {peekStatus(props.summary)}
        </span>
      </span>
    </WorkspaceCardPeek>
  );
}
