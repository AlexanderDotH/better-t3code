import type { ProviderEnhancementSurface } from "./PromptEnhancementTypes.ts";

export type AgentSkillId = "section-entry-print-layout";
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
