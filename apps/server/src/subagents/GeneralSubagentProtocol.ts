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
  agentIds: Schema.Array(SubagentId).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
  ),
});
export type GeneralSubagentWaitInput = typeof GeneralSubagentWaitInput.Type;

export const GeneralSubagentCancelInput = Schema.Struct({ agentId: SubagentId });
export type GeneralSubagentCancelInput = typeof GeneralSubagentCancelInput.Type;

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

export class GeneralSubagentError extends Schema.TaggedErrorClass<GeneralSubagentError>()(
  "GeneralSubagentError",
  {
    reason: Schema.Literals([
      "thread-unavailable",
      "provider-unavailable",
      "model-unavailable",
      "reasoning-effort-unavailable",
      "agent-unavailable",
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
