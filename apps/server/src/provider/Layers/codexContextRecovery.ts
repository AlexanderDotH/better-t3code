import type * as CodexSchema from "effect-codex-app-server/schema";
import { isCodexCompactionConflictMessage } from "@t3tools/shared/codexContext";

type CodexContextError = {
  readonly message: string;
  readonly codexErrorInfo?: CodexSchema.V2ErrorNotification["error"]["codexErrorInfo"];
};

export function isCodexCompactionConflict(error: CodexContextError) {
  const info = error.codexErrorInfo;
  return (
    (typeof info === "object" &&
      info !== null &&
      "activeTurnNotSteerable" in info &&
      info.activeTurnNotSteerable.turnKind === "compact") ||
    isCodexCompactionConflictMessage(error.message)
  );
}

export function isCodexContextFull(error: CodexContextError) {
  return (
    error.codexErrorInfo === "contextWindowExceeded" ||
    /context[_ ](?:window|length)(?:[_ ](?:limit|is))?[_ ](?:exceeded|full)|exceeds? (?:the |your |this model's )?(?:maximum )?context (?:window|length)/i.test(
      error.message,
    )
  );
}
