import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as GeneralSubagentCoordinator from "../../../subagents/GeneralSubagentCoordinator.ts";
import {
  GeneralSubagentCancelInput,
  GeneralSubagentCancelResult,
  GeneralSubagentError,
  GeneralSubagentFollowUpInput,
  GeneralSubagentFollowUpResult,
  GeneralSubagentInterruptInput,
  GeneralSubagentInterruptResult,
  GeneralSubagentListInput,
  GeneralSubagentListResult,
  GeneralSubagentModelsInput,
  GeneralSubagentModelsResult,
  GeneralSubagentSendMessageInput,
  GeneralSubagentSendMessageResult,
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
    "Wait up to 60 seconds for one or more T3 general-purpose subagents. Terminal agents return a structured outcome, changes or findings, verification, risks or blockers, and a transcript reference. Repeat while agents remain active; do not report their work as integrated until they are terminal.",
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

export const GeneralSubagentListTool = Tool.make("list_agents", {
  description:
    "List compact identity, provider, model, reasoning, and status fields for every direct T3-managed child owned by this root thread. Use wait_agent for terminal results.",
  parameters: GeneralSubagentListInput,
  success: GeneralSubagentListResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "List direct agents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentSpawnAgentTool = Tool.make("spawn_agent", {
  description:
    "Start one direct T3-managed child with a reusable provider session. A root may retain at most 40 direct children; children cannot spawn nested agents. Omitted provider and model fields inherit the caller selection.",
  parameters: GeneralSubagentSpawnInput,
  success: GeneralSubagentSpawnResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Spawn direct agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const GeneralSubagentSendMessageTool = Tool.make("send_message", {
  description:
    "Queue a message for one owned direct child. It is delivered at the next safe model boundary and never injected into an in-flight provider request.",
  parameters: GeneralSubagentSendMessageInput,
  success: GeneralSubagentSendMessageResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Message direct agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentFollowUpTool = Tool.make("followup_task", {
  description:
    "Queue follow-up work for one owned direct child. T3 starts the follow-up in the same provider session as soon as the child is idle and includes queued mailbox messages.",
  parameters: GeneralSubagentFollowUpInput,
  success: GeneralSubagentFollowUpResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Follow up with direct agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const GeneralSubagentWaitAgentTool = Tool.make("wait_agent", {
  description:
    "Wait up to 60 seconds for one or more owned direct children to reach an idle or terminal boundary. Terminal children return structured results with transcript references. Repeat when timedOut is true.",
  parameters: GeneralSubagentWaitInput,
  success: GeneralSubagentWaitResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for direct agents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentInterruptTool = Tool.make("interrupt_agent", {
  description:
    "Interrupt the active turn of one owned direct child while preserving its provider session for later follow-up work.",
  parameters: GeneralSubagentInterruptInput,
  success: GeneralSubagentInterruptResult,
  failure: GeneralSubagentError,
  dependencies,
})
  .annotate(Tool.Title, "Interrupt direct agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GeneralSubagentToolkit = Toolkit.make(
  GeneralSubagentModelsTool,
  GeneralSubagentSpawnTool,
  GeneralSubagentWaitTool,
  GeneralSubagentCancelTool,
  GeneralSubagentListTool,
  GeneralSubagentSpawnAgentTool,
  GeneralSubagentSendMessageTool,
  GeneralSubagentFollowUpTool,
  GeneralSubagentWaitAgentTool,
  GeneralSubagentInterruptTool,
);
