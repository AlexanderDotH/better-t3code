import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GeneralSubagentCoordinator from "../../../subagents/GeneralSubagentCoordinator.ts";
import {
  GeneralSubagentCancelInput,
  GeneralSubagentCancelResult,
  GeneralSubagentError,
  GeneralSubagentModelsInput,
  GeneralSubagentModelsResult,
  GeneralSubagentSpawnInput,
  GeneralSubagentSpawnResult,
  GeneralSubagentWaitInput,
  GeneralSubagentWaitResult,
} from "../../../subagents/GeneralSubagentProtocol.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  GeneralSubagentCoordinator.GeneralSubagentCoordinator,
];

export const GeneralSubagentModelsTool = Tool.make("subagent_models", {
  description:
    "List runnable T3 provider instances and models for general-purpose subagents, including supported reasoning-effort values. The current provider and model are marked as the preferred default; inspect this catalog when a task benefits from a specialist.",
  parameters: GeneralSubagentModelsInput,
  success: GeneralSubagentModelsResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "List subagent models")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentSpawnTool = Tool.make("subagent_spawn", {
  description:
    "Start an asynchronous general-purpose subagent for implementation, review, debugging, verification, or research. Omit providerInstanceId, model, and reasoningEffort to use the same provider and model as the caller. Prefer that inherited choice when suitable; otherwise use subagent_models and select the task-appropriate specialist and reasoning effort. This is not a read-only Fetch worker. Give each agent one concrete, non-overlapping task, then call subagent_wait before finalizing.",
  parameters: GeneralSubagentSpawnInput,
  success: GeneralSubagentSpawnResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Spawn general subagent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const GeneralSubagentWaitTool = Tool.make("subagent_wait", {
  description:
    "Wait up to 60 seconds for one or more T3 general-purpose subagents and return their latest status, output, and failure detail. Repeat while agents remain active; do not report their work as integrated until they are terminal.",
  parameters: GeneralSubagentWaitInput,
  success: GeneralSubagentWaitResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for general subagents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentCancelTool = Tool.make("subagent_cancel", {
  description:
    "Cancel one active T3 general-purpose subagent owned by this root thread, preserving its projected transcript and terminal status.",
  parameters: GeneralSubagentCancelInput,
  success: GeneralSubagentCancelResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Cancel general subagent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentToolkit = Toolkit.make(
  GeneralSubagentModelsTool,
  GeneralSubagentSpawnTool,
  GeneralSubagentWaitTool,
  GeneralSubagentCancelTool,
);
