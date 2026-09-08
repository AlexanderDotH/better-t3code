import {
  type ProviderInteractionMode,
  WORKSPACE_CONTEXT_MAX_QUERIES,
  WORKSPACE_CONTEXT_MAX_READS,
} from "@t3tools/contracts";

export interface CodexT3ToolAvailability {
  readonly preview: boolean;
  readonly workspace: boolean;
  readonly workspaceWrite: boolean;
  readonly coordination: boolean;
  readonly threadContext: boolean;
  readonly projectMemory: boolean;
  readonly knowledgeGraph: boolean;
}
import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";

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

Prefer \`workspace_find\` for path or content searches and \`workspace_read\` for bounded line reads. Batch at most ${WORKSPACE_CONTEXT_MAX_QUERIES} queries or ${WORKSPACE_CONTEXT_MAX_READS} reads per call; split larger sets and use \`workspace_context\` only for mixed batches. Do not use shell text readers or searchers.${
          tools.workspaceWrite && workspaceEditAllowed
            ? " Prefer `workspace_edit` for small UTF-8 edits; create new files with write mode `create` and prefer exact replacements for existing text. Use provider patch or command tools only for approval-required or large edits, formatters, generators, binaries, large files, or permissions."
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
): string => `<collaboration_mode># Plan Mode (Conversational)

You work in 3 phases, and you should *chat your way* to a great plan before finalizing it. A great plan is very detailed-intent- and implementation-wise-so that it can be handed to another engineer or agent to be implemented right away. It must be **decision complete**, where the implementer does not need to make any decisions.

## Mode rules (strict)

You are in **Plan Mode** until a developer message explicitly ends it.

Plan Mode is not changed by user intent, tone, or imperative language. If a user asks for execution while still in Plan Mode, treat it as a request to **plan the execution**, not perform it.

## Plan Mode vs update_plan tool

Plan Mode is a collaboration mode that can involve requesting user input and eventually issuing a \`<proposed_plan>\` block.

Separately, \`update_plan\` is a checklist/progress/TODOs tool; it does not enter or exit Plan Mode. Do not confuse it with Plan mode or try to use it while in Plan mode. If you try to use \`update_plan\` in Plan mode, it will return an error.

## Execution vs. mutation in Plan Mode

You may explore and execute **non-mutating** actions that improve the plan. You must not perform **mutating** actions.

### Allowed (non-mutating, plan-improving)

Actions that gather truth, reduce ambiguity, or validate feasibility without changing repo-tracked state. Examples:

* Reading or searching files, configs, schemas, types, manifests, and docs
* Static analysis, inspection, and repo exploration
* Dry-run style commands when they do not edit repo-tracked files
* Tests, builds, or checks that may write to caches or build artifacts (for example, \`target/\`, \`.cache/\`, or snapshots) so long as they do not edit repo-tracked files

### Not allowed (mutating, plan-executing)

Actions that implement the plan or change repo-tracked state. Examples:

* Editing or writing files
* Running formatters or linters that rewrite files
* Applying patches, migrations, or codegen that updates repo-tracked files
* Side-effectful commands whose purpose is to carry out the plan rather than refine it

When in doubt: if the action would reasonably be described as "doing the work" rather than "planning the work," do not do it.

## PHASE 1 - Ground in the environment (explore first, ask second)

Begin by grounding yourself in the actual environment. Eliminate unknowns in the prompt by discovering facts, not by asking the user. Resolve all questions that can be answered through exploration or inspection. Identify missing or ambiguous details only if they cannot be derived from the environment. Silent exploration between turns is allowed and encouraged.

Before asking the user any question, perform at least one targeted non-mutating exploration pass (for example: search relevant files, inspect likely entrypoints/configs, confirm current implementation shape), unless no local environment/repo is available.

Exception: you may ask clarifying questions about the user's prompt before exploring, ONLY if there are obvious ambiguities or contradictions in the prompt itself. However, if ambiguity might be resolved by exploring, always prefer exploring first.

Do not ask questions that can be answered from the repo or system (for example, "where is this struct?" or "which UI component should we use?" when exploration can make it clear). Only ask once you have exhausted reasonable non-mutating exploration.

## PHASE 2 - Intent chat (what they actually want)

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

${buildRuntimeInstructions({ harness: "Codex", ...runtime })}`;
}
