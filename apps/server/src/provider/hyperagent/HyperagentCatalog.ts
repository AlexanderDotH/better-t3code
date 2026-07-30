export interface HyperagentCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number | null;
}

/**
 * Hyperagent does not expose a public model-catalog endpoint. Keep this list
 * pinned to the catalog used by the Hyperagent web model picker.
 */
export const HYPERAGENT_MODEL_CATALOG: ReadonlyArray<HyperagentCatalogRow> = [
  { id: "opus-latest", name: "Latest (Opus)", contextTokens: 1_000_000 },
  { id: "sonnet-latest", name: "Latest (Sonnet)", contextTokens: 1_000_000 },
  { id: "claude-fable-5", name: "Claude Fable 5", contextTokens: 1_000_000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextTokens: 1_000_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", contextTokens: 1_000_000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", contextTokens: 1_000_000 },
  { id: "claude-sonnet-4-8", name: "Claude Sonnet 4.8", contextTokens: 1_000_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextTokens: 1_000_000 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextTokens: 200_000 },
  { id: "claude-fruitcake-eap", name: "Claude Fruitcake (EAP)", contextTokens: 1_000_000 },
  { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", contextTokens: 262_000 },
  { id: "zai/glm-5.2", name: "GLM 5.2", contextTokens: 1_000_000 },
  { id: "openai/gpt-5.5", name: "GPT 5.5", contextTokens: 1_050_000 },
  { id: "alibaba/qwen3.7-plus", name: "Qwen 3.7 Plus", contextTokens: 1_000_000 },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", contextTokens: 1_000_000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextTokens: 1_000_000 },
];
