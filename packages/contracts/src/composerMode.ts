import * as Schema from "effect/Schema";

export const ComposerMode = Schema.Literals(["default", "plan", "deep-plan", "chat"]);
export type ComposerMode = typeof ComposerMode.Type;

export function composerModeToProviderInteractionMode(
  mode: ComposerMode,
): "default" | "plan" | "chat" {
  return mode === "deep-plan" ? "plan" : mode;
}
