import { Collapsible } from "@base-ui/react/collapsible";
import { useContext, type ReactNode } from "react";
import { ChatSizeMotionContext } from "./ChatSizeMotion";

/** Keep details mounted through the closing transition, then release their content. */
export function ChatDetailPanel({
  expanded,
  motion,
  id,
  children,
}: {
  expanded: boolean;
  motion: boolean;
  id?: string;
  children: ReactNode;
}) {
  const parentOwnsHeight = useContext(ChatSizeMotionContext);
  return (
    <Collapsible.Root open={expanded}>
      <Collapsible.Panel
        id={id}
        className="better-chat-detail-panel"
        data-motion={motion && !parentOwnsHeight}
        inert={!expanded}
      >
        <div className="better-chat-detail-content">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
