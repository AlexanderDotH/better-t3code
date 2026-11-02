import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Schema from "effect/Schema";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ProjectAgentClaimSetInput,
  ProjectAgentClaimSetResult,
  ProjectAgentCoordinationError,
  ProjectAgentInboxInput,
  ProjectAgentInboxResult,
  ProjectAgentListInput,
  ProjectAgentListResult,
  ProjectAgentMessageSendInput,
  ProjectAgentMessageSendResult,
} from "@t3tools/contracts";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectAgentCoordinator from "../../../projectAgent/ProjectAgentCoordinator.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";

const dependencies = [
  ThreadManagementService,
  McpInvocationContext.McpInvocationContext,
  ProjectAgentCoordinator.ProjectAgentCoordinator,
  OrchestratorV2,
];

const ProjectAgentListTool = Tool.make("project_agent_list", {
  description:
    "List this authenticated thread plus active and recent offline peer chats in the same T3 project, including their current work claims and this project's inbox counts. Use before starting overlapping work and at safe checkpoints.",
  parameters: ProjectAgentListInput,
  success: ProjectAgentListResult,
  failure: Schema.Union([OrchestratorMcpFailure, ProjectAgentCoordinationError]),
  dependencies,
})
  .annotate(Tool.Title, "List project-agent chats")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hasThreadCapability("coordination"));

const ProjectAgentClaimTool = Tool.make("project_agent_claim", {
  description:
    "Set or release this authenticated thread's turn-scoped cooperative work claims. Set replaces the complete claim set atomically and reports overlaps without changing the previous lease.",
  parameters: ProjectAgentClaimSetInput,
  success: ProjectAgentClaimSetResult,
  failure: Schema.Union([OrchestratorMcpFailure, ProjectAgentCoordinationError]),
  dependencies,
})
  .annotate(Tool.Title, "Claim project work")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hasThreadCapability("coordination"));

const ProjectAgentSendTool = Tool.make("project_agent_send", {
  description:
    "Send a durable coordination message in this authenticated thread's project. Broadcast reaches active peers only; a direct message may target an offline peer and atomically wakes that peer's existing chat with a new turn.",
  parameters: ProjectAgentMessageSendInput,
  success: ProjectAgentMessageSendResult,
  failure: Schema.Union([OrchestratorMcpFailure, ProjectAgentCoordinationError]),
  dependencies,
})
  .annotate(Tool.Title, "Message project agents")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hasThreadCapability("coordination"));

const ProjectAgentInboxTool = Tool.make("project_agent_inbox", {
  description:
    "Read this authenticated thread's durable project-agent inbox and optionally acknowledge the cursor returned by an earlier call. Check at safe work checkpoints; messages never steer a running turn automatically.",
  parameters: ProjectAgentInboxInput,
  success: ProjectAgentInboxResult,
  failure: Schema.Union([OrchestratorMcpFailure, ProjectAgentCoordinationError]),
  dependencies,
})
  .annotate(Tool.Title, "Read project-agent inbox")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hasThreadCapability("coordination"));

export const CoordinationToolkit = Toolkit.make(
  ProjectAgentListTool,
  ProjectAgentClaimTool,
  ProjectAgentSendTool,
  ProjectAgentInboxTool,
);
