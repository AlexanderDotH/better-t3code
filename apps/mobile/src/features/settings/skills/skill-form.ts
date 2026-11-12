import { SkillCreateInput, SkillUpdateInput, type SkillDescriptor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { skillMutationTarget } from "../environment-agent-settings";
import { ManagementFormError, managementScopeInput, type ManagementScope } from "../mcp/mcp-form";

const decodeSkillCreate = Schema.decodeUnknownSync(SkillCreateInput);
const decodeSkillUpdate = Schema.decodeUnknownSync(SkillUpdateInput);

export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly body: string;
}

export function skillDraftFromDescriptor(skill: SkillDescriptor | null): SkillDraft {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    displayName: skill?.displayName ?? "",
    shortDescription: skill?.shortDescription ?? "",
    body: skill?.body ?? "",
  };
}

export function validateSkillDraft(draft: SkillDraft) {
  if (!draft.name.trim() || !draft.description.trim()) {
    throw new ManagementFormError("settings.skills.required");
  }
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    displayName: draft.displayName.trim(),
    shortDescription: draft.shortDescription.trim(),
    body: draft.body,
  };
}

export function skillCreateFromDraft(draft: SkillDraft, scope: ManagementScope): SkillCreateInput {
  return decodeSkillCreate({
    ...validateSkillDraft(draft),
    ...managementScopeInput(scope),
  });
}

export function skillUpdateFromDraft(draft: SkillDraft, skill: SkillDescriptor): SkillUpdateInput {
  const { name: _name, ...contents } = validateSkillDraft(draft);
  return decodeSkillUpdate({
    target: skillMutationTarget(skill),
    ...contents,
  });
}
