import { managedRuntimeModeDenial, type ManagedPolicySummary } from "@t3tools/contracts";
import { selectableProviderOptionChoices as selectableChoices } from "@t3tools/client-runtime/model-traits";
export { selectableProviderOptionChoices as selectableChoices } from "@t3tools/client-runtime/model-traits";
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
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    get label() {
      return currentInterfaceTranslator().message("chat.composer.access.supervised");
    },
    get description() {
      return currentInterfaceTranslator().message("chat.composer.access.supervisedDescription");
    },
  },
  {
    mode: "auto-accept-edits",
    get label() {
      return currentInterfaceTranslator().message("chat.composer.access.autoAccept");
    },
    get description() {
      return currentInterfaceTranslator().message("chat.composer.access.autoAcceptDescription");
    },
  },
  {
    mode: "auto",
    get label() {
      return currentInterfaceTranslator().message("chat.composer.access.auto");
    },
    get description() {
      return currentInterfaceTranslator().message("chat.composer.access.autoDescription");
    },
  },
  {
    mode: "full-access",
    get label() {
      return currentInterfaceTranslator().message("settings.betterT3.value.full");
    },
    get description() {
      return currentInterfaceTranslator().message("chat.composer.access.fullDescription");
    },
  },
];

export function runtimeModeChoicesForSupportedModes(
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
) {
  return supportedRuntimeModes && supportedRuntimeModes.length > 0
    ? RUNTIME_MODE_CHOICES.filter((choice) => supportedRuntimeModes.includes(choice.mode))
    : RUNTIME_MODE_CHOICES;
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
          label: currentInterfaceTranslator().message("chat.composer.access.auto"),
          description: currentInterfaceTranslator().message(
            "mobile.ui.setsReasoningLevelBasedOnYourPrompt",
          ),
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

export type RuntimeModeChoice = (typeof RUNTIME_MODE_CHOICES)[number] & {
  /** Set when a target environment's managed policy caps runtime modes below this one. */
  readonly disabledReason?: string;
};

/**
 * Marks modes above a managed runtime ceiling. A control acting on several environments is
 * managed when any of them is, so the first target that refuses a mode supplies its reason.
 */
export function withManagedRuntimeModeLimits(
  choices: ReadonlyArray<RuntimeModeChoice>,
  policies: ReadonlyArray<ManagedPolicySummary | undefined>,
): ReadonlyArray<RuntimeModeChoice> {
  return choices.map((choice) => {
    const reason = policies
      .map((policy) => managedRuntimeModeDenial(policy, choice.mode))
      .find((denial) => denial !== undefined);
    return reason === undefined ? choice : { ...choice, disabledReason: reason };
  });
}

/**
 * A new thread's mode: the draft's choice unless the managed ceiling refuses it, then the
 * default, which the server already reads back at or below the ceiling.
 */
export function resolveNewThreadRuntimeMode(
  draftMode: RuntimeMode | undefined,
  defaultMode: RuntimeMode,
  policy: ManagedPolicySummary | undefined,
): RuntimeMode {
  return draftMode !== undefined && managedRuntimeModeDenial(policy, draftMode) === undefined
    ? draftMode
    : defaultMode;
}

export function compatibleRuntimeModeForChoices(
  runtimeMode: RuntimeMode,
  choices: ReadonlyArray<{ readonly mode: RuntimeMode }>,
): RuntimeMode {
  return choices.some((choice) => choice.mode === runtimeMode)
    ? runtimeMode
    : (choices[0]?.mode ?? runtimeMode);
}
