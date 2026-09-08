import {
  CODEX_REASONING_EFFORT_OPTION_ID,
  T3_AUTO_REASONING_OPTION_ID,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderOptionDescriptor,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  enableAutoReasoning,
  isAutoReasoningEnabled,
  selectManualReasoningEffort,
} from "@t3tools/shared/model";

import { applyProviderOptionSelection } from "../../lib/providerOptions";

/**
 * Desktop-oriented effort keywords that don't belong in the phone picker.
 * Prompt-injected values (ultrathink and friends) are filtered from the
 * descriptor metadata; ultracode is a real option but a workflow trigger, not
 * a reasoning level. A value set elsewhere still displays, it just isn't
 * offered.
 */
const HIDDEN_EFFORT_OPTION_IDS: ReadonlySet<string> = new Set(["ultracode"]);

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Ruled",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full",
    description: "Allow commands and edits without prompts.",
  },
];

export function selectableChoices(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
) {
  const injected = new Set(descriptor.promptInjectedValues ?? []);
  return descriptor.options.filter(
    (option) => !injected.has(option.id) && !HIDDEN_EFFORT_OPTION_IDS.has(option.id),
  );
}

export function threadReasoningChoices(
  provider: ProviderDriverKind | null,
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
) {
  const choices = selectableChoices(descriptor);
  return provider === "codex" &&
    descriptor.id === CODEX_REASONING_EFFORT_OPTION_ID &&
    descriptor.options.length > 0
    ? [
        {
          id: T3_AUTO_REASONING_OPTION_ID,
          label: "Auto",
          description: "Sets reasoning level based on your prompt input.",
        },
        ...choices,
      ]
    : choices;
}

/** Applies the choice surfaced by the thread sheet, including Auto's durable marker. */
export function applyThreadOptionChoice(input: {
  readonly selection: ModelSelection;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly id: string;
  readonly value: string | boolean;
}): ModelSelection | null {
  if (
    input.id === CODEX_REASONING_EFFORT_OPTION_ID &&
    input.value === T3_AUTO_REASONING_OPTION_ID
  ) {
    return enableAutoReasoning(input.selection);
  }
  if (input.id === CODEX_REASONING_EFFORT_OPTION_ID && typeof input.value === "string") {
    const next = applyProviderOptionSelection(input.descriptors, {
      id: input.id,
      value: input.value,
    });
    return next === null
      ? null
      : selectManualReasoningEffort({ ...input.selection, options: next }, input.value);
  }

  const next = applyProviderOptionSelection(input.descriptors, {
    id: input.id,
    value: input.value,
  });
  if (next === null) return null;
  const selection = { ...input.selection, options: next };
  return isAutoReasoningEnabled(input.selection) ? enableAutoReasoning(selection) : selection;
}
