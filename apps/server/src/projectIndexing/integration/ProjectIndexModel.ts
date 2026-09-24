import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { isFetchCapableProvider } from "@t3tools/shared/fetchMode";
import {
  createCodexContextWindowDescriptor,
  getModelSelectionStringOptionValue,
  resolveCodexContextWindowTokens,
} from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

const ANALYSIS_OUTPUT_RESERVATION = 16_384;
const MINIMUM_ANALYSIS_CONTEXT = 4_096;
// Native harness instructions are outside the supplied source prompt. This is
// a policy allowance, not a measured bound; unexpected compaction still fails.
const CODEX_INSTRUCTION_RESERVATION = 16_384;

export class ProjectIndexModelError extends Schema.TaggedError<ProjectIndexModelError>()(
  "ProjectIndexModelError",
  { message: Schema.String },
) {}

export const isProjectIndexModelError = Schema.is(ProjectIndexModelError);

function requestedContextWindow(selection: ModelSelection): number | undefined {
  const value = getModelSelectionStringOptionValue(selection, "contextWindow");
  if (value === undefined || value === "default") return undefined;
  const match = /^(\d+)(k|m)?$/i.exec(value);
  if (match === null)
    throw new ProjectIndexModelError({ message: "The selected context window is invalid." });
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const tokens = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(tokens) || tokens <= 0)
    throw new ProjectIndexModelError({ message: "The selected context window is invalid." });
  return tokens;
}

function modelContextWindows(provider: ServerProvider, selection: ModelSelection) {
  const context = provider.models.find((candidate) => candidate.slug === selection.model)
    ?.capabilities?.contextWindow;
  if (context === undefined)
    throw new ProjectIndexModelError({
      message: "Configure the selected model's context capacity before starting project analysis.",
    });
  const percent = (context.effectivePercent ?? 100) / 100;
  if (provider.driver !== "codex")
    return [{ value: "default", tokens: Math.floor(context.defaultTokens * percent) }];
  const requested = requestedContextWindow(selection);
  if (requested !== undefined && requested > context.maxTokens)
    throw new ProjectIndexModelError({
      message: "The selected context window exceeds the model's advertised capacity.",
    });
  if (
    requested !== undefined &&
    resolveCodexContextWindowTokens({
      ...selection,
      options: [{ id: "contextWindow", value: String(requested) }],
    }) === undefined
  )
    throw new ProjectIndexModelError({
      message: "The selected context window is not supported by this provider adapter.",
    });
  const explicitlyDefault =
    getModelSelectionStringOptionValue(selection, "contextWindow") === "default";
  const maximum = requested ?? (explicitlyDefault ? context.defaultTokens : context.maxTokens);
  const descriptor = createCodexContextWindowDescriptor(context);
  const windows = descriptor.options.map((option) => ({
    value: option.id,
    rawTokens: option.id === "default" ? context.defaultTokens : Number(option.id),
  }));
  if (requested !== undefined) windows.push({ value: String(requested), rawTokens: requested });
  return windows
    .filter((window) => window.rawTokens <= maximum)
    .map((window) => ({ value: window.value, tokens: Math.floor(window.rawTokens * percent) }))
    .filter((window) => window.tokens >= MINIMUM_ANALYSIS_CONTEXT)
    .sort((left, right) => left.tokens - right.tokens);
}

export function resolveProjectIndexModel(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
) {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (provider === undefined || !isFetchCapableProvider(provider)) {
    throw new ProjectIndexModelError({
      message: "The selected provider cannot currently enforce read-only analysis sessions.",
    });
  }
  const model = provider.models.find(
    (candidate) => candidate.slug === selection.model && candidate.isSelectable !== false,
  );
  if (model === undefined) {
    throw new ProjectIndexModelError({ message: "The selected analysis model is unavailable." });
  }
  const supportedContextWindows = [
    ...new Set(modelContextWindows(provider, selection).map((window) => window.tokens)),
  ];
  const contextWindowTokens = supportedContextWindows.at(-1) ?? 0;
  if (contextWindowTokens < MINIMUM_ANALYSIS_CONTEXT) {
    throw new ProjectIndexModelError({
      message: "The selected context window is too small for analysis.",
    });
  }
  return {
    provider,
    contextWindowTokens,
    supportedContextWindows,
    promptOverheadTokens: provider.driver === "codex" ? CODEX_INSTRUCTION_RESERVATION : 0,
    maxOutputTokens: Math.min(ANALYSIS_OUTPUT_RESERVATION, Math.floor(contextWindowTokens / 4)),
  };
}

export function projectIndexWorkerSelection(
  provider: ServerProvider,
  selection: ModelSelection,
  contextWindowTokens: number,
): ModelSelection {
  const window = modelContextWindows(provider, selection).find(
    (candidate) => candidate.tokens >= contextWindowTokens,
  );
  if (window === undefined)
    throw new ProjectIndexModelError({
      message: "The analysis request exceeds the selected provider context capacity.",
    });
  if (provider.driver !== "codex") return selection;
  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter((option) => option.id !== "contextWindow"),
      { id: "contextWindow", value: window.value },
    ],
  };
}
