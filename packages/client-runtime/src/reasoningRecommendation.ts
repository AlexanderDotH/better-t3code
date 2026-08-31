import type {
  ModelCapabilities,
  ModelSelection,
  OrchestrationThreadActivity,
  ProviderOptionSelection,
  SelectProviderOptionDescriptor,
} from "@t3tools/contracts";
import { isAutoReasoningEnabled } from "@t3tools/shared/model";

const REASONING_OPTION_IDS = new Set(["reasoningEffort", "effort"]);
const TOOL_LIFECYCLE_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "dynamic_tool_call",
  "collab_agent_tool_call",
  "web_search",
  "image_view",
]);
const READ_ONLY_COMMANDS = new Set(["rg", "head", "tail", "cat", "ls", "pwd", "wc", "stat"]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "grep",
  "ls-files",
  "rev-parse",
]);
const MUTATING_COMMANDS = new Set([
  "rm",
  "mv",
  "cp",
  "install",
  "touch",
  "mkdir",
  "rmdir",
  "ln",
  "chmod",
  "chown",
  "truncate",
  "dd",
  "tee",
  "patch",
  "apply_patch",
]);
const MUTATING_GIT_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "config",
  "fetch",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
  "worktree",
]);
const SHELL_CONTROL_PATTERN = /(?:\r|\n|&&|\|\||[;|<>]|`|\$\()/u;
const FIND_MUTATION_PATTERN =
  /(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0)(?:\s|$)/u;
const SED_MUTATION_PATTERN = /(?:^|\s)(?:-i(?:\S*)?|--in-place(?:=\S*)?)(?:\s|$)/u;
const KNOWN_EFFORT_RANK = new Map([
  ["none", 0],
  ["minimal", 1],
  ["low", 2],
  ["medium", 3],
  ["high", 4],
  ["xhigh", 5],
  ["extra_high", 5],
  ["max", 6],
  ["ultra", 7],
]);

type UnknownRecord = Record<string, unknown>;

export interface ReasoningRecommendation {
  readonly evidenceTurnId: string;
  readonly discoveryOperationCount: number;
  readonly completedToolOperationCount: number;
  readonly optionId: string;
  readonly currentValue: string;
  readonly currentLabel: string;
  readonly targetValue: string;
  readonly targetLabel: string;
  readonly instanceId: string;
  readonly model: string;
}

export interface PendingReasoningOverride {
  readonly evidenceTurnId: string;
  readonly instanceId: string;
  readonly model: string;
  readonly optionId: string;
  readonly fromValue: string;
  readonly fromLabel: string;
  readonly targetValue: string;
  readonly targetLabel: string;
}

export interface ReasoningRecommendationState {
  readonly handledEvidenceTurnId?: string;
  readonly pendingOverride?: PendingReasoningOverride;
}

interface ToolClassification {
  readonly operationCount: number;
  readonly explorationCount: number;
  readonly knownMutation: boolean;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function itemType(activity: OrchestrationThreadActivity): string | null {
  return asTrimmedString(asRecord(activity.payload)?.itemType);
}

function shellBasename(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).replace(/^['"]|['"]$/gu, "");
}

function unwrapShellArray(command: ReadonlyArray<unknown>): string | null {
  const parts = command.flatMap((part) => {
    const text = asTrimmedString(part);
    return text === null ? [] : [text];
  });
  const executable = parts[0] ? shellBasename(parts[0]).toLowerCase() : null;
  if (
    executable &&
    ["sh", "bash", "zsh", "dash", "pwsh", "powershell", "powershell.exe"].includes(executable)
  ) {
    const wrapperIndex = parts.findIndex((part) =>
      ["-c", "-lc", "-command"].includes(part.toLowerCase()),
    );
    if (wrapperIndex >= 0) {
      return parts[wrapperIndex + 1] ?? null;
    }
  }
  return parts.join(" ");
}

function unwrapShellString(value: string): string {
  const withoutReceipt = value.replace(/\s*<exited with exit code \d+>\s*$/u, "").trim();
  const shellWrapper = withoutReceipt.match(
    /^(?:"[^"]*(?:sh|pwsh|powershell)(?:\.exe)?"|'[^']*(?:sh|pwsh|powershell)(?:\.exe)?'|\S*(?:sh|pwsh|powershell)(?:\.exe)?)\s+(?:-[^\s]*c|-Command)\s+(['"])([\s\S]*)\1$/iu,
  );
  return shellWrapper?.[2]?.trim() ?? withoutReceipt;
}

function commandValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return unwrapShellArray(value);
  }
  const direct = asTrimmedString(value);
  return direct === null ? null : unwrapShellString(direct);
}

function extractCommand(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemInput = asRecord(item?.input);
  const itemResult = asRecord(item?.result);
  const candidates = [
    item?.command,
    itemInput?.command,
    itemResult?.command,
    data?.command,
    payload?.command,
    payload?.detail,
  ];
  for (const candidate of candidates) {
    const command = commandValue(candidate);
    if (command !== null) {
      return command;
    }
  }
  return null;
}

function commandWords(command: string): ReadonlyArray<string> {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? [];
}

function gitSubcommand(words: ReadonlyArray<string>): string | null {
  let index = 1;
  while (index < words.length) {
    const word = words[index];
    if (word === "-C" || word === "--git-dir" || word === "--work-tree") {
      index += 2;
      continue;
    }
    if (word?.startsWith("--git-dir=") || word?.startsWith("--work-tree=")) {
      index += 1;
      continue;
    }
    return word?.toLowerCase() ?? null;
  }
  return null;
}

function classifyCommand(command: string | null): ToolClassification {
  if (command === null) {
    return { operationCount: 1, explorationCount: 0, knownMutation: false };
  }
  const words = commandWords(command);
  const executable = words[0] ? shellBasename(words[0]).toLowerCase() : "";
  const subcommand = executable === "git" ? gitSubcommand(words) : null;
  const knownMutation =
    MUTATING_COMMANDS.has(executable) ||
    (executable === "sed" && SED_MUTATION_PATTERN.test(command)) ||
    (executable === "find" && FIND_MUTATION_PATTERN.test(command)) ||
    (executable === "git" && subcommand !== null && MUTATING_GIT_SUBCOMMANDS.has(subcommand));
  const unknownGitCommand =
    executable === "git" &&
    (subcommand === null ||
      (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand) && !MUTATING_GIT_SUBCOMMANDS.has(subcommand)));
  if (knownMutation || unknownGitCommand || SHELL_CONTROL_PATTERN.test(command)) {
    // Shell composition and unknown Git verbs make the operation impossible
    // to prove read-only from the first executable alone.
    return { operationCount: 1, explorationCount: 0, knownMutation: true };
  }
  const readOnly =
    READ_ONLY_COMMANDS.has(executable) ||
    (executable === "sed" && !SED_MUTATION_PATTERN.test(command)) ||
    (executable === "find" && !FIND_MUTATION_PATTERN.test(command)) ||
    (executable === "git" && subcommand !== null && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand));
  return {
    operationCount: 1,
    explorationCount: readOnly ? 1 : 0,
    knownMutation: false,
  };
}

function parseArguments(value: unknown): UnknownRecord | null {
  const direct = asRecord(value);
  if (direct !== null) {
    return direct;
  }
  const encoded = asTrimmedString(value);
  if (encoded === null) {
    return null;
  }
  try {
    return asRecord(JSON.parse(encoded) as unknown);
  } catch {
    return null;
  }
}

function workspaceContextOperationCount(activity: OrchestrationThreadActivity): number | null {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const tool = [item?.tool, item?.name, data?.tool, data?.toolName, payload?.tool].find(
    (candidate) => asTrimmedString(candidate)?.toLowerCase() === "workspace_context",
  );
  if (tool === undefined) {
    return null;
  }
  const args = [item?.arguments, item?.input, data?.arguments, data?.input, payload?.arguments]
    .map(parseArguments)
    .find((candidate) => candidate !== null);
  const queryCount = Array.isArray(args?.queries) ? args.queries.length : 0;
  const readCount = Array.isArray(args?.reads) ? args.reads.length : 0;
  return Math.max(1, queryCount + readCount);
}

function classifyCompletedTool(activity: OrchestrationThreadActivity): ToolClassification | null {
  if (activity.kind !== "tool.completed") {
    return null;
  }
  const type = itemType(activity);
  if (type === null || !TOOL_LIFECYCLE_ITEM_TYPES.has(type)) {
    return null;
  }
  if (type === "file_change") {
    return { operationCount: 1, explorationCount: 0, knownMutation: true };
  }
  if (type === "command_execution") {
    return classifyCommand(extractCommand(activity));
  }
  if (type === "mcp_tool_call") {
    const operationCount = workspaceContextOperationCount(activity);
    if (operationCount !== null) {
      return { operationCount, explorationCount: operationCount, knownMutation: false };
    }
  }
  return { operationCount: 1, explorationCount: 0, knownMutation: false };
}

function reasoningDescriptor(
  capabilities: ModelCapabilities | null | undefined,
): SelectProviderOptionDescriptor | null {
  return (
    capabilities?.optionDescriptors?.find(
      (descriptor): descriptor is SelectProviderOptionDescriptor =>
        descriptor.type === "select" && REASONING_OPTION_IDS.has(descriptor.id),
    ) ?? null
  );
}

function selectedStringOption(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
  optionId: string,
): string | null {
  const value = options?.find((option) => option.id === optionId)?.value;
  return typeof value === "string" ? value : null;
}

function currentDescriptorValue(
  descriptor: SelectProviderOptionDescriptor,
  selection: ModelSelection,
): string | null {
  return (
    selectedStringOption(selection.options, descriptor.id) ??
    descriptor.currentValue ??
    descriptor.options.find((choice) => choice.isDefault)?.id ??
    descriptor.options[0]?.id ??
    null
  );
}

function effortRank(value: string): number | null {
  return KNOWN_EFFORT_RANK.get(value.toLowerCase()) ?? null;
}

function targetChoice(
  descriptor: SelectProviderOptionDescriptor,
  currentValue: string,
): SelectProviderOptionDescriptor["options"][number] | null {
  const currentIndex = descriptor.options.findIndex((choice) => choice.id === currentValue);
  if (currentIndex < 0) {
    return null;
  }
  const highIndex = descriptor.options.findIndex((choice) => choice.id.toLowerCase() === "high");
  if (highIndex >= 0) {
    return currentIndex > highIndex ? (descriptor.options[highIndex] ?? null) : null;
  }
  const currentRank = effortRank(currentValue);
  const highRank = effortRank("high")!;
  if (currentRank === null || currentRank <= highRank) {
    return null;
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const choice = descriptor.options[index];
    if (choice && (effortRank(choice.id) ?? Number.POSITIVE_INFINITY) < currentRank) {
      return choice;
    }
  }
  return null;
}

export function deriveReasoningRecommendation(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly durableSelection: ModelSelection;
  readonly latestCompletedTurnId: string | null;
  readonly threadIdle: boolean;
  readonly handledEvidenceTurnId: string | null | undefined;
}): ReasoningRecommendation | null {
  if (
    isAutoReasoningEnabled(input.durableSelection) ||
    !input.threadIdle ||
    input.latestCompletedTurnId === null ||
    input.latestCompletedTurnId === input.handledEvidenceTurnId
  ) {
    return null;
  }
  const descriptor = reasoningDescriptor(input.capabilities);
  if (descriptor === null) {
    return null;
  }
  const currentValue = currentDescriptorValue(descriptor, input.durableSelection);
  if (currentValue === null) {
    return null;
  }
  const target = targetChoice(descriptor, currentValue);
  const current = descriptor.options.find((choice) => choice.id === currentValue);
  if (target === null || current === undefined) {
    return null;
  }

  let completedToolOperationCount = 0;
  let discoveryOperationCount = 0;
  let knownMutation = false;
  for (const activity of input.activities) {
    if (activity.turnId !== input.latestCompletedTurnId) {
      continue;
    }
    const classification = classifyCompletedTool(activity);
    if (classification === null) {
      if (itemType(activity) === "file_change") {
        knownMutation = true;
      }
      continue;
    }
    completedToolOperationCount += classification.operationCount;
    discoveryOperationCount += classification.explorationCount;
    knownMutation ||= classification.knownMutation;
  }
  if (
    knownMutation ||
    discoveryOperationCount < 4 ||
    completedToolOperationCount === 0 ||
    discoveryOperationCount / completedToolOperationCount < 0.8
  ) {
    return null;
  }
  return {
    evidenceTurnId: input.latestCompletedTurnId,
    discoveryOperationCount,
    completedToolOperationCount,
    optionId: descriptor.id,
    currentValue,
    currentLabel: current.label,
    targetValue: target.id,
    targetLabel: target.label,
    instanceId: input.durableSelection.instanceId,
    model: input.durableSelection.model,
  };
}

export function acceptReasoningRecommendation(
  state: ReasoningRecommendationState | null | undefined,
  recommendation: ReasoningRecommendation,
): ReasoningRecommendationState {
  return {
    ...state,
    handledEvidenceTurnId: recommendation.evidenceTurnId,
    pendingOverride: {
      evidenceTurnId: recommendation.evidenceTurnId,
      instanceId: recommendation.instanceId,
      model: recommendation.model,
      optionId: recommendation.optionId,
      fromValue: recommendation.currentValue,
      fromLabel: recommendation.currentLabel,
      targetValue: recommendation.targetValue,
      targetLabel: recommendation.targetLabel,
    },
  };
}

export function dismissReasoningRecommendation(
  state: ReasoningRecommendationState | null | undefined,
  recommendation: ReasoningRecommendation,
): ReasoningRecommendationState {
  const { pendingOverride: _, ...withoutPending } = state ?? {};
  return {
    ...withoutPending,
    handledEvidenceTurnId: recommendation.evidenceTurnId,
  };
}

export function pendingReasoningOverrideMatchesSelection(
  pending: PendingReasoningOverride | null | undefined,
  selection: ModelSelection,
): pending is PendingReasoningOverride {
  if (
    pending === null ||
    pending === undefined ||
    pending.instanceId !== selection.instanceId ||
    pending.model !== selection.model
  ) {
    return false;
  }
  const currentValue = selectedStringOption(selection.options, pending.optionId);
  return currentValue === null || currentValue === pending.fromValue;
}

export function reconcileReasoningRecommendationState(
  state: ReasoningRecommendationState | null | undefined,
  durableSelection: ModelSelection,
): ReasoningRecommendationState | null {
  if (state === null || state === undefined || state.pendingOverride === undefined) {
    return state ?? null;
  }
  if (pendingReasoningOverrideMatchesSelection(state.pendingOverride, durableSelection)) {
    return state;
  }
  const { pendingOverride: _, ...withoutPending } = state;
  return withoutPending;
}

export function undoReasoningRecommendationOverride(
  state: ReasoningRecommendationState,
): ReasoningRecommendationState {
  const { pendingOverride: _, ...withoutPending } = state;
  return withoutPending;
}

export function samePendingReasoningOverride(
  left: PendingReasoningOverride | null | undefined,
  right: PendingReasoningOverride | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  return (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.evidenceTurnId === right.evidenceTurnId &&
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    left.optionId === right.optionId &&
    left.fromValue === right.fromValue &&
    left.targetValue === right.targetValue
  );
}

export function consumeReasoningRecommendationOverride(
  state: ReasoningRecommendationState,
  consumed: PendingReasoningOverride,
): ReasoningRecommendationState {
  if (!samePendingReasoningOverride(state.pendingOverride, consumed)) {
    return state;
  }
  const { pendingOverride: _, ...withoutPending } = state;
  return withoutPending;
}

export function resolveReasoningTurnModelSelection(
  durableSelection: ModelSelection,
  pending: PendingReasoningOverride | null | undefined,
): { readonly turnModelSelection: ModelSelection; readonly applied: boolean } {
  if (!pendingReasoningOverrideMatchesSelection(pending, durableSelection)) {
    return { turnModelSelection: durableSelection, applied: false };
  }
  const existingOptions = durableSelection.options ?? [];
  const hasOption = existingOptions.some((option) => option.id === pending.optionId);
  const options = hasOption
    ? existingOptions.map((option) =>
        option.id === pending.optionId ? { ...option, value: pending.targetValue } : option,
      )
    : [...existingOptions, { id: pending.optionId, value: pending.targetValue }];
  return {
    turnModelSelection: { ...durableSelection, options },
    applied: true,
  };
}
