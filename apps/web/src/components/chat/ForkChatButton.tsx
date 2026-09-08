import { GitForkIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ForkChatButton(props: {
  readonly available: boolean;
  readonly busy: boolean;
  readonly dispatchPending: boolean;
  readonly onFork: () => void;
}) {
  const label = props.busy ? "Forking chat" : "Fork chat from here";
  const tooltip = !props.available
    ? "Reconnect to fork this chat"
    : props.dispatchPending
      ? "Creating fork"
      : "Fork chat from here";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={!props.available || props.dispatchPending}
            aria-label={label}
            aria-busy={props.busy || undefined}
            onClick={props.onFork}
          />
        }
      >
        <GitForkIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
