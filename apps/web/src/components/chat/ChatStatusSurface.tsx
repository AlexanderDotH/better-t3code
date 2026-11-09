import type { ReactNode } from "react";
import { ButtonAppearanceContext } from "../ui/button";

export type ChatStatusTone = "neutral" | "info" | "success" | "warning" | "error";

/** Better T3 status bubble around existing status content; other presentations render it bare. */
export function ChatStatusSurface({
  enabled,
  children,
  tone = "neutral",
  compact = false,
}: {
  enabled: boolean;
  children: ReactNode;
  tone?: ChatStatusTone | undefined;
  compact?: boolean;
}) {
  if (!enabled) return children;
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
