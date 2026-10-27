import type { ReactNode } from "react";
import { useChatVisualMode } from "../../chatVisualModeSync";
import { ButtonAppearanceContext } from "../ui/button";

export type ChatStatusTone = "neutral" | "info" | "success" | "warning" | "error";

/** Adapts existing status content without changing its actions or lifecycle. */
export function ChatStatusSurface({
  children,
  tone = "neutral",
  compact = false,
}: {
  children: ReactNode;
  tone?: ChatStatusTone;
  compact?: boolean;
}) {
  const better = useChatVisualMode() === "better-t3";
  if (!better) return children;
  return (
    <ButtonAppearanceContext value="soft">
      <div
        className="better-chat-bubble better-chat-status"
        data-chat-tone={tone}
        data-chat-compact={compact}
      >
        {children}
      </div>
    </ButtonAppearanceContext>
  );
}
