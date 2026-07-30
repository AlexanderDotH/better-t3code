export type {
  ProviderEnhancementSurface,
  ProviderPromptPayload,
  ProviderPromptTarget,
} from "./PromptEnhancementTypes.ts";
export { appendPromptAppendix } from "./PromptEnhancementTypes.ts";

export type { CavemanPromptMode, CavemanPromptStyleOptions } from "./CavemanPromptStyle.ts";
export {
  CAVEMAN_PROMPT_MODES,
  CAVEMAN_REPO_URL,
  buildCavemanPromptAppendix,
  injectCavemanPromptStyle,
} from "./CavemanPromptStyle.ts";

export type {
  DeepThinkingAccumulatedData,
  DeepThinkingMessage,
  DeepThinkingMessagePart,
} from "./DeepThinkingPrompts.ts";
export {
  DEEP_THINKING_DECOMPOSE_SCHEMA_DESC,
  DEEP_THINKING_REFINE_SCHEMA_DESC,
  DEEP_THINKING_STEP_SCHEMA_DESC,
  buildAccumulatedDeepThinkingData,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildDecomposeRepairUserPrompt,
  buildDecomposeSystemPrompt,
  buildDecomposeUserPrompt,
  buildRefinementSystemPrompt,
  buildRefinementUserPrompt,
  buildStepWorkRepairUserPrompt,
  buildStepWorkSystemPrompt,
  buildStepWorkUserPrompt,
  extractTaskTextFromMessages,
} from "./DeepThinkingPrompts.ts";

export type {
  AgentSkillContext,
  AgentSkillDefinition,
  AgentSkillId,
  AgentSkillSurface,
  PageVerticalPaddingContract,
  PageVerticalPaddingSource,
} from "./SkillPromptTypes.ts";
export { AGENT_SKILL_IDS, isAgentSkillId } from "./SkillPromptTypes.ts";

export {
  SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID,
  buildPageVerticalPaddingPromptBlock,
  buildSectionEntryPrintLayoutAppendix,
  resolveSectionEntryPageVerticalPadding,
  sectionEntryPrintLayoutSkill,
} from "./SectionEntryPrintLayoutSkill.ts";

export type {
  BuildEnabledSkillPromptAppendixOptions,
  InjectBundledSkillPromptOptions,
} from "./SkillPromptInjection.ts";
export {
  BUILT_IN_AGENT_SKILLS,
  buildEnabledSkillPromptAppendix,
  getBuiltInAgentSkillById,
  injectBundledSkillPrompts,
} from "./SkillPromptInjection.ts";
