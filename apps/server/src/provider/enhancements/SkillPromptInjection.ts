import type { ProviderPromptPayload, ProviderPromptTarget } from "./PromptEnhancementTypes.ts";
import { appendPromptAppendix } from "./PromptEnhancementTypes.ts";
import { sectionEntryPrintLayoutSkill } from "./SectionEntryPrintLayoutSkill.ts";
import type { AgentSkillContext, AgentSkillDefinition, AgentSkillId } from "./SkillPromptTypes.ts";
import { isAgentSkillId } from "./SkillPromptTypes.ts";

export const BUILT_IN_AGENT_SKILLS = [
  sectionEntryPrintLayoutSkill,
] as const satisfies ReadonlyArray<AgentSkillDefinition>;

export interface BuildEnabledSkillPromptAppendixOptions {
  readonly enabledSkillIds?: ReadonlySet<string> | ReadonlyArray<string> | undefined;
  readonly skills?: ReadonlyArray<AgentSkillDefinition> | undefined;
}

export interface InjectBundledSkillPromptOptions extends BuildEnabledSkillPromptAppendixOptions {
  readonly target?: ProviderPromptTarget | undefined;
  readonly includeWorkflowPhase?: boolean | undefined;
}

function normalizeEnabledSkillIds(
  value: ReadonlySet<string> | ReadonlyArray<string> | undefined,
): ReadonlySet<string> {
  if (!value) return new Set();
  return value instanceof Set ? value : new Set(value);
}

export function getBuiltInAgentSkillById(id: AgentSkillId): AgentSkillDefinition | undefined {
  return BUILT_IN_AGENT_SKILLS.find((skill) => skill.id === id);
}

export function buildEnabledSkillPromptAppendix(
  ctx: AgentSkillContext,
  options: BuildEnabledSkillPromptAppendixOptions = {},
): string {
  if (ctx.surface === "preflightGuardrail") return "";

  const enabledIds = normalizeEnabledSkillIds(options.enabledSkillIds);
  if (enabledIds.size === 0) return "";

  const skills = options.skills ?? BUILT_IN_AGENT_SKILLS;
  const parts: string[] = [];

  for (const skill of skills) {
    if (!enabledIds.has(skill.id)) continue;
    if (!skill.surfaces.includes(ctx.surface)) continue;
    if (ctx.phase && !skill.phases.includes(ctx.phase)) continue;

    const appendix = skill.buildAppendix(ctx).trim();
    if (appendix) parts.push(appendix);
  }

  if (parts.length === 0) return "";
  return `\n${parts.join("\n\n")}`;
}

export function injectBundledSkillPrompts(
  payload: ProviderPromptPayload,
  ctx: AgentSkillContext,
  options: InjectBundledSkillPromptOptions = {},
): ProviderPromptPayload {
  if (ctx.surface === "preflightGuardrail") return payload;
  if (ctx.surface === "workflowPhase" && options.includeWorkflowPhase !== true) return payload;

  const appendix = buildEnabledSkillPromptAppendix(ctx, options);
  return appendPromptAppendix(payload, appendix, options.target ?? "system");
}

export { isAgentSkillId };
