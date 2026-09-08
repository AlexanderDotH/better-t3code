import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import type { WorkspaceDeckPosition } from "./workspaceCardDeck.logic";

export interface WorkspaceCardPeekProps<CardId extends string> {
  readonly cardId: CardId;
  readonly label: string;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
  readonly blocked: boolean;
  readonly onActivate: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

export function WorkspaceCardPeek<CardId extends string>(props: WorkspaceCardPeekProps<CardId>) {
  const translate = useInterfaceTranslator().message;
  return (
    <div
      className={cn(
        "workspace-card-deck__peek",
        `workspace-card-deck__peek--${props.position}`,
        props.className,
      )}
      data-workspace-card-peek={props.cardId}
      data-peek-position={props.position}
      data-blocked={props.blocked ? "true" : undefined}
    >
      <button
        type="button"
        className="workspace-card-deck__peek-trigger"
        data-workspace-card-peek-trigger="true"
        aria-label={translate("sidebar.workspaceDeck.openCard", { card: props.label })}
        aria-disabled={props.blocked}
        onClick={() => {
          if (props.blocked) return;
          props.onActivate();
        }}
      />
      <div className="workspace-card-deck__peek-content">{props.children}</div>
    </div>
  );
}
