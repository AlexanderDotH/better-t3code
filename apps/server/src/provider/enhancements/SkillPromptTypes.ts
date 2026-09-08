import type { ProviderEnhancementSurface } from "./PromptEnhancementTypes.ts";

export const AGENT_SKILL_IDS = ["section-entry-print-layout"] as const;

export type AgentSkillId = (typeof AGENT_SKILL_IDS)[number];
export type AgentSkillSurface = Exclude<ProviderEnhancementSurface, "preflightGuardrail">;

export type PageVerticalPaddingSource = "customer-form" | "wizard" | "explicit";

export interface PageVerticalPaddingContract {
  readonly topMm: number;
  readonly bottomMm: number;
  readonly applyTo?: "all_pages" | undefined;
  readonly source?: PageVerticalPaddingSource | undefined;
}

export interface AgentSkillContext {
  readonly phase?: string | undefined;
  readonly surface: ProviderEnhancementSurface;
  readonly pageVerticalPadding?: PageVerticalPaddingContract | null | undefined;
  readonly customerFormPromptMarkdown?: string | null | undefined;
  readonly pageBreakMode?: string | null | undefined;
}

export interface AgentSkillDefinition {
  readonly id: AgentSkillId;
  readonly i18nKey: string;
  readonly phases: ReadonlyArray<string>;
  readonly surfaces: ReadonlyArray<AgentSkillSurface>;
  readonly buildAppendix: (ctx: AgentSkillContext) => string;
}

export function isAgentSkillId(value: string): value is AgentSkillId {
  return (AGENT_SKILL_IDS as ReadonlyArray<string>).includes(value);
}
