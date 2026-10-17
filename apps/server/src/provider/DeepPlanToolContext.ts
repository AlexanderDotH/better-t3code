import type { ThreadId } from "@t3tools/contracts";

import { readMcpProviderSession } from "../mcp/McpProviderSession.ts";
import { isDeepPlanToolName } from "../mcp/toolkits/deep-plan/toolNames.ts";

export function deepPlanContextForThread(threadId: ThreadId) {
  const session = readMcpProviderSession(threadId);
  return session?.capabilities.has("deep-plan") ? session.deepPlan : undefined;
}

export function isBoundDeepPlanTool(threadId: ThreadId, toolName: string): boolean {
  return deepPlanContextForThread(threadId) !== undefined && isDeepPlanToolName(toolName);
}
