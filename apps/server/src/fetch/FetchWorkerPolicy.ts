import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

import type { FetchWorkerOutcomeStatus } from "./FetchWorkerState.ts";

export type FetchApprovalAction = "accept" | "decline" | "fail-worker";

export function buildFetchWorkerPrompt(input: {
  readonly userRequest: string;
  readonly scope: string;
  readonly questions: ReadonlyArray<string>;
}): string {
  const questions = input.questions.map((question) => `- ${question}`).join("\n");
  return `T3 FETCH — READ-ONLY REPOSITORY EXPLORATION

Original user request:
${input.userRequest}

Your independent scope:
${input.scope}

Questions to answer:
${questions}

Return concise exploratory evidence with exact paths, symbols, existing conventions, focused tests, and risks. Clearly distinguish confirmed evidence from inference.

Policy:
- Do not edit files, apply patches, create files, or change repository state.
- Do not run mutating commands or make external changes.
- Use the authenticated T3 workspace_context tool for batched repository searches and bounded reads when it is available. Otherwise use only provider-native bounded file, path, and text-search tools.
- Do not execute shell or terminal commands, including read-only Git commands, and do not use general-purpose code execution tools to invoke them indirectly.
- Do not ask the user questions; work only from the supplied request and repository.
- Do not start or delegate to nested agents.
- Do not implement the requested change. Return discovery findings only.`;
}

export function fetchApprovalAction(requestType: string): FetchApprovalAction {
  if (requestType === "tool_user_input") return "fail-worker";
  if (requestType === "file_read_approval") return "accept";
  return "decline";
}

export function fetchWorkerTerminalStatus(
  event: ProviderRuntimeEvent,
): FetchWorkerOutcomeStatus | null {
  if (event.type === "turn.aborted") return "interrupted";
  if (event.type === "turn.completed") {
    if (event.payload.state === "completed") return "completed";
    if (event.payload.state === "interrupted" || event.payload.state === "cancelled") {
      return "interrupted";
    }
    return "error";
  }
  if (event.type === "session.exited") return "error";
  if (event.type === "session.state.changed" && event.payload.state === "error") return "error";
  return null;
}

export function fetchWorkerTerminalDetail(event: ProviderRuntimeEvent): string | undefined {
  if (event.type === "turn.aborted") return event.payload.reason;
  if (event.type === "turn.completed") {
    return event.payload.errorMessage ?? event.payload.stopReason ?? undefined;
  }
  if (event.type === "session.exited") return event.payload.reason;
  if (event.type === "session.state.changed") return event.payload.reason;
  return undefined;
}

export function isNestedFetchAgentEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.subagentId !== undefined ||
    event.type === "subagent.discovered" ||
    event.type === "subagent.state.changed" ||
    ((event.type === "item.started" || event.type === "item.updated") &&
      event.payload.itemType === "collab_agent_tool_call")
  );
}

const BOUNDED_READ_TOOL_NAMES = new Set(["read", "grep", "glob", "list", "search", "find"]);

function isProviderNativeBoundedReadEvent(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
): boolean {
  if (event.payload.itemType !== "dynamic_tool_call") return false;
  if (!Predicate.isObject(event.payload.data)) return false;
  const nestedItem = Predicate.isObject(event.payload.data.item)
    ? event.payload.data.item
    : undefined;
  const candidates = [
    event.payload.data.toolName,
    event.payload.data.tool,
    event.payload.data.kind,
    nestedItem?.toolName,
    nestedItem?.tool,
    nestedItem?.kind,
  ];
  return candidates.some(
    (candidate) =>
      Predicate.isString(candidate) && BOUNDED_READ_TOOL_NAMES.has(candidate.trim().toLowerCase()),
  );
}

function isAuthenticatedWorkspaceContextEvent(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
): boolean {
  if (event.payload.itemType !== "mcp_tool_call") return false;
  if (!Predicate.isObject(event.payload.data)) return false;
  const item = Predicate.isObject(event.payload.data.item) ? event.payload.data.item : undefined;
  const server = Predicate.isString(item?.server) ? item.server.trim().toLowerCase() : undefined;
  const tool = Predicate.isString(item?.tool) ? item.tool.trim().toLowerCase() : undefined;
  return server === "t3-code" && tool === "workspace_context";
}

export function isFetchMutationEvent(event: ProviderRuntimeEvent): boolean {
  if (event.type === "files.persisted") return true;
  if (
    event.type !== "item.started" &&
    event.type !== "item.updated" &&
    event.type !== "item.completed"
  ) {
    return false;
  }
  if (event.payload.itemType === "file_change") return true;
  if (event.payload.itemType === "command_execution") return true;
  if (event.payload.itemType === "mcp_tool_call") {
    return !isAuthenticatedWorkspaceContextEvent(event);
  }
  return event.payload.itemType === "dynamic_tool_call" && !isProviderNativeBoundedReadEvent(event);
}
