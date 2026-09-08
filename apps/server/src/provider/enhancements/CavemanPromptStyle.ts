import type {
  ProviderEnhancementSurface,
  ProviderPromptPayload,
} from "./PromptEnhancementTypes.ts";
import { appendPromptAppendix } from "./PromptEnhancementTypes.ts";

export const CAVEMAN_REPO_URL = "https://github.com/JuliusBrussee/caveman";

export const CAVEMAN_PROMPT_MODES = ["off", "lite", "full", "ultra"] as const;

export type CavemanPromptMode = (typeof CAVEMAN_PROMPT_MODES)[number];

export interface CavemanPromptStyleOptions {
  readonly mode: CavemanPromptMode;
  readonly surface?: ProviderEnhancementSurface | undefined;
}

export function buildCavemanPromptAppendix(mode: CavemanPromptMode): string {
  if (mode === "off") return "";

  const shared = `
### Caveman mode (optional terse voice)
Inspired by the Caveman skill (${CAVEMAN_REPO_URL}, MIT). Goal: shorter assistant replies without dropping technical facts.

**Hard rules (override caveman tone):**
- Any **JSON**, **fenced code**, paths, identifiers, and German **template headings / printed CV copy** must stay **valid and verbatim** where the task requires it. Syntax correctness beats terse style.
- Reasoning stream may stay structured; keep **English** for technical critique unless the product explicitly selects another language mode later.

**Voice (${mode}):**`;

  switch (mode) {
    case "lite":
      return `${shared}
- Drop filler and hedging; keep normal grammar and full sentences when needed for clarity.`;
    case "full":
      return `${shared}
- Short sentences. Drop fluff articles where clarity stays OK. Telegraphic OK for bullets.`;
    case "ultra":
      return `${shared}
- Maximum compression: telegraphic phrases, minimal glue words. Still obey the hard rules above.`;
  }
}

export function injectCavemanPromptStyle(
  payload: ProviderPromptPayload,
  options: CavemanPromptStyleOptions,
): ProviderPromptPayload {
  if (options.surface === "preflightGuardrail") return payload;
  return appendPromptAppendix(payload, buildCavemanPromptAppendix(options.mode), "system");
}
