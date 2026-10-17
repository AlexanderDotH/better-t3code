import * as Schema from "effect/Schema";

export const ComposerMode = Schema.Literals(["default", "plan", "deep-plan"]);
export type ComposerMode = typeof ComposerMode.Type;
export const DEFAULT_COMPOSER_MODE: ComposerMode = "default";

export function composerModeToProviderInteractionMode(mode: ComposerMode): "default" | "plan" {
  return mode === "default" ? "default" : "plan";
}
