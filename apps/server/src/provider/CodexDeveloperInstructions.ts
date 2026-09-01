import type { ProviderInteractionMode } from "@t3tools/contracts";

export interface CodexT3ToolAvailability {
  readonly preview: boolean;
  readonly workspace: boolean;
  readonly workspaceWrite: boolean;
  readonly coordination: boolean;
  readonly threadContext: boolean;
  readonly projectMemory: boolean;
  readonly knowledgeGraph: boolean;
}

const ALL_T3_TOOLS: CodexT3ToolAvailability = {
  preview: true,
  workspace: true,
  workspaceWrite: true,
  coordination: true,
  threadContext: true,
  projectMemory: true,
  knowledgeGraph: true,
};

const NO_T3_TOOLS: CodexT3ToolAvailability = {
  preview: false,
  workspace: false,
  workspaceWrite: false,
  coordination: false,
  threadContext: false,
  projectMemory: false,
  knowledgeGraph: false,
};

function availability(value: boolean | CodexT3ToolAvailability): CodexT3ToolAvailability {
  return typeof value === "boolean" ? (value ? ALL_T3_TOOLS : NO_T3_TOOLS) : value;
}

function toolInstructions(
  value: boolean | CodexT3ToolAvailability,
  workspaceEditAllowed: boolean,
): string {
  const tools = availability(value);
  return [
    tools.preview
      ? `## T3 browser

Use the attached T3 preview tools for browser work. Start with \`preview_status\`, open a preview when needed, prefer snapshot locators, and retry actionable failures before switching browser systems.`
      : "",
    tools.workspace
      ? `## T3 workspace

Prefer \`workspace_find\` for path or content searches and \`workspace_read\` for bounded line reads. Batch independent operations into the fewest calls; use \`workspace_context\` only for mixed search-and-read batches. Do not use shell text readers or searchers.${
          tools.workspaceWrite && workspaceEditAllowed
            ? " Prefer `workspace_edit` for ordinary UTF-8 text changes and batch related files in one call. Use provider patch or command tools only for approval-required edits, formatters, generators, binaries, large files, or permission changes."
            : ""
        }`
      : "",
    tools.projectMemory
      ? `## Project memory

Use \`project_memory\` only for verified durable facts or explicit requests. Never store credentials.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function delegationInstructions(value: boolean | CodexT3ToolAvailability): string {
  const tools = availability(value);
  return `## Delegation history

Automatic delegation uses \`fork_turns: "none"\` and a self-contained brief. Use a positive fork_turns count only for necessary recent exchanges, and full history only when explicitly requested.${tools.threadContext ? " Retrieve exact older messages with `thread_context`." : ""} Do not impose an agent-count cap.`;
}

export const codexPlanModeDeveloperInstructions = (
  tools: boolean | CodexT3ToolAvailability,
): string => `<collaboration_mode># Plan Mode

Plan Mode remains active until a developer message changes it. Explore with non-mutating reads, searches, tests, and builds, but do not edit tracked files or execute the plan.

Resolve discoverable facts before asking. Ask only when a material product choice cannot be inferred safely. A final plan must be decision complete, concise by default, and wrapped once in \`<proposed_plan>\` and \`</proposed_plan>\`. A revision is a complete replacement of the prior plan.

${toolInstructions(tools, false)}
</collaboration_mode>`;

export const codexDefaultModeDeveloperInstructions = (
  tools: boolean | CodexT3ToolAvailability,
): string => `<collaboration_mode># Collaboration Mode: Default

Default mode remains active until a developer message changes it. Make safe in-scope assumptions and execute the request. Use \`request_user_input\` only when that tool is listed in the available tools and a material decision cannot be discovered or inferred safely.

${toolInstructions(tools, true)}
</collaboration_mode>`;

export const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS =
  codexPlanModeDeveloperInstructions(ALL_T3_TOOLS);
export const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS =
  codexDefaultModeDeveloperInstructions(ALL_T3_TOOLS);

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly reasoningEffort: string;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export function buildCodexDeveloperInstructions(
  interactionMode: ProviderInteractionMode,
  runtime: CodexRuntimeInfo,
  tools: boolean | CodexT3ToolAvailability = ALL_T3_TOOLS,
): string {
  const base =
    interactionMode === "plan"
      ? codexPlanModeDeveloperInstructions(tools)
      : codexDefaultModeDeveloperInstructions(tools);
  return `${base}\n\n${delegationInstructions(tools)}

<runtime_info>In case you're asked: you are running in T3 Code through the Codex harness, as ${toSingleLine(runtime.model)} with ${toSingleLine(runtime.reasoningEffort)} reasoning effort. No need to mention this otherwise.</runtime_info>`;
}
