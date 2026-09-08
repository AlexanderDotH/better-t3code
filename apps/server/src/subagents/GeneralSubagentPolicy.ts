import type { OrchestrationSubagentStatus, ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  GeneralSubagentDetailedResult,
  type GeneralSubagentDetailedResult as GeneralSubagentDetailedResultType,
} from "./GeneralSubagentProtocol.ts";

export type GeneralSubagentApprovalAction = "accept" | "decline" | "fail-agent";
export type GeneralSubagentOutcomeStatus = "completed" | "interrupted" | "error" | "timed-out";

export interface GeneralSubagentOutcome {
  readonly status: GeneralSubagentOutcomeStatus;
  readonly detail?: string;
}

const decodeGeneralSubagentDetailedResult = Schema.decodeUnknownSync(GeneralSubagentDetailedResult);

function finalResultContract(agentId: string): string {
  return `Your last assistant message must be exactly one JSON object, with no markdown fence or surrounding prose:
{
  "outcome": "concise completed outcome or blocker",
  "changesOrFindings": [{ "path": "relative/path/or/url", "details": "what changed or was found" }],
  "verification": [{ "command": "exact command or check", "result": "observed result" }],
  "risksOrBlockers": ["remaining risk or blocker"],
  "transcriptRef": "subagent:${agentId}"
}
Use empty arrays when a section has no entries.`;
}

export function buildGeneralSubagentPrompt(input: {
  readonly task: string;
  readonly parentThreadId: string;
  readonly agentId: string;
}): string {
  return `T3 GENERAL-PURPOSE SUBAGENT

You are a direct implementation agent delegated by the root thread ${input.parentThreadId}. Work in the same workspace and under the root thread's existing project claims.

Your task:
${input.task}

Execution contract:
- Complete this concrete scope end to end. You may inspect, edit, and test files when the task requires it and the inherited runtime permissions allow it.
- Keep changes inside this scope, preserve unrelated and concurrent work, and coordinate through the parent result instead of widening ownership.
- Use focused verification proportionate to the change. Report exact files changed, tests run, results, and any remaining risk.
- Do not ask the user questions; return blockers and required decisions to the parent agent.
- Do not spawn nested agents.
- Do not claim the parent task is complete. Return your scoped outcome so the parent can integrate and verify it.

Final response contract:
${finalResultContract(input.agentId)}`;
}

export function buildGeneralSubagentFollowUpPrompt(input: {
  readonly task: string;
  readonly messages: ReadonlyArray<string>;
  readonly agentId: string;
}): string {
  const mailbox =
    input.messages.length === 0
      ? ""
      : `\n\nMessages queued by the parent and delivered at this safe boundary:\n${input.messages
          .map((message, index) => `${index + 1}. ${message}`)
          .join("\n")}`;
  return `T3 DIRECT SUBAGENT FOLLOW-UP

Continue in the existing provider session. Complete this follow-up task end to end:
${input.task}${mailbox}

Keep the same execution contract: remain within the delegated scope, do not spawn nested agents, verify focused work, and return the scoped outcome to the parent.

Final response contract:
${finalResultContract(input.agentId)}`;
}

export function parseGeneralSubagentFinalResult(
  message: string,
  agentId: string,
): GeneralSubagentDetailedResultType {
  const transcriptRef = `subagent:${agentId}`;
  try {
    const parsed = decodeGeneralSubagentDetailedResult(JSON.parse(message), {
      onExcessProperty: "error",
    });
    if (parsed.transcriptRef === transcriptRef) {
      return parsed;
    }
  } catch {
    // The fallback intentionally preserves the full provider message for the parent.
  }
  return {
    outcome: message,
    changesOrFindings: [],
    verification: [],
    risksOrBlockers: [],
    transcriptRef,
  };
}

export function generalSubagentApprovalAction(requestType: string): GeneralSubagentApprovalAction {
  if (requestType === "tool_user_input") return "fail-agent";
  if (requestType === "file_read_approval") return "accept";
  return "decline";
}

export function generalSubagentTerminalStatus(
  event: ProviderRuntimeEvent,
): GeneralSubagentOutcomeStatus | null {
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

export function generalSubagentTerminalDetail(event: ProviderRuntimeEvent): string | undefined {
  if (event.type === "turn.aborted") return event.payload.reason;
  if (event.type === "turn.completed") {
    return event.payload.errorMessage ?? event.payload.stopReason ?? undefined;
  }
  if (event.type === "session.exited") return event.payload.reason;
  if (event.type === "session.state.changed") return event.payload.reason;
  return undefined;
}

export function assistantTextFromCompletedItem(event: ProviderRuntimeEvent): string | undefined {
  if (event.type !== "item.completed" || event.payload.itemType !== "assistant_message") {
    return undefined;
  }
  if (event.payload.detail) return event.payload.detail;
  const data = event.payload.data;
  if (typeof data !== "object" || data === null || !("text" in data)) return undefined;
  return typeof data.text === "string" && data.text.length > 0 ? data.text : undefined;
}

export function generalSubagentOrchestrationStatus(
  status: GeneralSubagentOutcomeStatus,
): OrchestrationSubagentStatus {
  if (status === "timed-out") return "error";
  return status;
}
