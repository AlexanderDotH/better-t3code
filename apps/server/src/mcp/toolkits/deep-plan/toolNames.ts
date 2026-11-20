const toolsByPhase = {
  planning: new Set([
    "deep_plan_state",
    "deep_plan_publish",
    "deep_plan_explore",
    "deep_plan_block",
  ]),
  execution: new Set(["deep_plan_state", "deep_plan_submit", "deep_plan_block"]),
  review: new Set(["deep_plan_state", "deep_plan_review_context", "deep_plan_review_verdict"]),
};

const deepPlanToolNames = new Set(Object.values(toolsByPhase).flatMap((names) => [...names]));
const reviewerWorkspaceTools = new Set(["workspace_find", "workspace_read", "workspace_context"]);

export function isDeepPlanToolName(name: string): boolean {
  return deepPlanToolNames.has(name.replace(/^mcp__t3-code__/, ""));
}

export function isDeepPlanToolForPhase(phase: keyof typeof toolsByPhase, name: string): boolean {
  return deepPlanToolNamesForPhase(phase).has(name.replace(/^mcp__t3-code__/, ""));
}

export function deepPlanToolNamesForPhase(phase: keyof typeof toolsByPhase): ReadonlySet<string> {
  return toolsByPhase[phase];
}

export function isDeepPlanReviewerTool(name: string): boolean {
  return isDeepPlanToolForPhase("review", name) || reviewerWorkspaceTools.has(name);
}
