import {
  OrchestrationSubagentStatus,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const BoundedTask = TrimmedNonEmptyString.check(Schema.isMaxLength(40_000));
const BoundedLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

export const GeneralSubagentModelsInput = Schema.Struct({});
export type GeneralSubagentModelsInput = typeof GeneralSubagentModelsInput.Type;

export const GeneralSubagentSpawnInput = Schema.Struct({
  task: BoundedTask,
  name: Schema.optionalKey(BoundedLabel),
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  reasoningEffort: Schema.optionalKey(TrimmedNonEmptyString),
});
export type GeneralSubagentSpawnInput = typeof GeneralSubagentSpawnInput.Type;

export const GeneralSubagentWaitInput = Schema.Struct({
  agentIds: Schema.Array(SubagentId).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
  ),
});
export type GeneralSubagentWaitInput = typeof GeneralSubagentWaitInput.Type;

export const GeneralSubagentCancelInput = Schema.Struct({ agentId: SubagentId });
export type GeneralSubagentCancelInput = typeof GeneralSubagentCancelInput.Type;

export const GeneralSubagentListInput = Schema.Struct({});
export type GeneralSubagentListInput = typeof GeneralSubagentListInput.Type;

export const GeneralSubagentSendMessageInput = Schema.Struct({
  agentId: SubagentId,
  message: BoundedTask,
});
export type GeneralSubagentSendMessageInput = typeof GeneralSubagentSendMessageInput.Type;

export const GeneralSubagentFollowUpInput = Schema.Struct({
  agentId: SubagentId,
  task: BoundedTask,
});
export type GeneralSubagentFollowUpInput = typeof GeneralSubagentFollowUpInput.Type;

export const GeneralSubagentInterruptInput = GeneralSubagentCancelInput;
export type GeneralSubagentInterruptInput = typeof GeneralSubagentInterruptInput.Type;

const GeneralSubagentModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  reasoningEfforts: Schema.Array(TrimmedNonEmptyString),
});

const GeneralSubagentProvider = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: TrimmedNonEmptyString,
  current: Schema.Boolean,
  models: Schema.Array(GeneralSubagentModel),
});

export const GeneralSubagentModelsResult = Schema.Struct({
  providers: Schema.Array(GeneralSubagentProvider),
});
export type GeneralSubagentModelsResult = typeof GeneralSubagentModelsResult.Type;

export const GeneralSubagentSpawnResult = Schema.Struct({
  agentId: SubagentId,
  status: OrchestrationSubagentStatus,
  providerInstanceId: ProviderInstanceId,
  providerDriver: ProviderDriverKind,
  model: TrimmedNonEmptyString,
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
});
export type GeneralSubagentSpawnResult = typeof GeneralSubagentSpawnResult.Type;

export const GeneralSubagentSnapshot = Schema.Struct({
  ...GeneralSubagentSpawnResult.fields,
  task: BoundedTask,
  output: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
});
export type GeneralSubagentSnapshot = typeof GeneralSubagentSnapshot.Type;

export const GeneralSubagentListResult = Schema.Struct({
  agents: Schema.Array(GeneralSubagentSnapshot),
});
export type GeneralSubagentListResult = typeof GeneralSubagentListResult.Type;

export const GeneralSubagentWaitResult = Schema.Struct({
  agents: Schema.Array(GeneralSubagentSnapshot),
  allTerminal: Schema.Boolean,
  timedOut: Schema.Boolean,
});
export type GeneralSubagentWaitResult = typeof GeneralSubagentWaitResult.Type;

export const GeneralSubagentCancelResult = Schema.Struct({
  agent: GeneralSubagentSnapshot,
  cancelled: Schema.Boolean,
});
export type GeneralSubagentCancelResult = typeof GeneralSubagentCancelResult.Type;

export const GeneralSubagentSendMessageResult = Schema.Struct({
  agent: GeneralSubagentSnapshot,
  queued: Schema.Boolean,
});
export type GeneralSubagentSendMessageResult = typeof GeneralSubagentSendMessageResult.Type;

export const GeneralSubagentFollowUpResult = GeneralSubagentSendMessageResult;
export type GeneralSubagentFollowUpResult = typeof GeneralSubagentFollowUpResult.Type;

export const GeneralSubagentInterruptResult = Schema.Struct({
  agent: GeneralSubagentSnapshot,
  interrupted: Schema.Boolean,
});
export type GeneralSubagentInterruptResult = typeof GeneralSubagentInterruptResult.Type;

export class GeneralSubagentError extends Schema.TaggedErrorClass<GeneralSubagentError>()(
  "GeneralSubagentError",
  {
    reason: Schema.Literals([
      "thread-unavailable",
      "provider-unavailable",
      "model-unavailable",
      "reasoning-effort-unavailable",
      "agent-unavailable",
      "direct-child-limit",
      "nested-spawn-disabled",
      "spawn-failed",
      "operation-failed",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
