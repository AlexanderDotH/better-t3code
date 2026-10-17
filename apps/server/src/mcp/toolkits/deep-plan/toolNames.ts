export const DEEP_PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "deep_plan_state",
  "deep_plan_sources",
  "deep_plan_analyze_sources",
  "deep_plan_read_source",
  "deep_plan_summarize_source",
  "deep_plan_publish",
  "deep_plan_step_update",
  "deep_plan_adjust_procedure",
  "deep_plan_validation",
]);

export function isDeepPlanToolName(name: string): boolean {
  return DEEP_PLAN_TOOL_NAMES.has(name.replace(/^mcp__t3-code__/, ""));
}
