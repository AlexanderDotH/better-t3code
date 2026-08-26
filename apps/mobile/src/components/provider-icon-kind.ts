export type ProviderIconKind =
  | "claude"
  | "cursor"
  | "gemini"
  | "grok"
  | "opencode"
  | "openrouter"
  | "codex";

export function providerIconKind(provider: string | null | undefined): ProviderIconKind {
  switch (provider) {
    case "claudeAgent":
      return "claude";
    case "cursor":
    case "gemini":
    case "grok":
    case "opencode":
    case "openrouter":
      return provider;
    default:
      return "codex";
  }
}
