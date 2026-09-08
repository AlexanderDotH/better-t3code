import {
  createInterfaceTranslator,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import type {
  PlanImplementationStrategy,
  PlanImplementationSuggestion,
  PlanParallelismReviewStatus,
} from "@t3tools/client-runtime/plan-implementation";

interface PlanImplementationMenuAction {
  readonly id: string;
  readonly label: string;
  readonly target: "same-thread" | "new-thread";
  readonly strategy: PlanImplementationStrategy;
  readonly suggested: boolean;
}

interface PlanImplementationActionPresentation {
  readonly primaryLabel: string;
  readonly primaryAriaLabel: string | null;
  readonly menuActions: ReadonlyArray<PlanImplementationMenuAction>;
}

const STANDARD_IMPLEMENTATION_STRATEGY = { kind: "standard" } as const;
const englishTranslate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
type Translate = InterfaceTranslator["message"];

interface PlanImplementationReviewPresentation {
  readonly actionsDisabled: boolean;
  readonly primaryLabel: string | null;
  readonly tooltip: string | null;
}

export function resolvePlanImplementationReviewPresentation(
  status: PlanParallelismReviewStatus,
  translate: Translate = englishTranslate,
): PlanImplementationReviewPresentation {
  if (status === "reviewing") {
    return {
      actionsDisabled: true,
      primaryLabel: translate("chat.composer.analyzingPlan"),
      tooltip: null,
    };
  }
  if (status === "fallback") {
    return {
      actionsDisabled: false,
      primaryLabel: null,
      tooltip: translate("chat.composer.planReviewFallback"),
    };
  }
  return {
    actionsDisabled: false,
    primaryLabel: null,
    tooltip: null,
  };
}

export function buildPlanImplementationActionPresentation(input: {
  readonly compact: boolean;
  readonly suggestion: PlanImplementationSuggestion | null;
  readonly translate?: Translate;
}): PlanImplementationActionPresentation {
  const translate = input.translate ?? englishTranslate;
  const suggestion = input.suggestion;
  if (!suggestion) {
    return {
      primaryLabel: translate("chat.composer.implement"),
      primaryAriaLabel: null,
      menuActions: [
        {
          id: "standard:new-thread",
          label: translate("chat.composer.implementNewThread"),
          target: "new-thread",
          strategy: STANDARD_IMPLEMENTATION_STRATEGY,
          suggested: false,
        },
      ],
    };
  }

  const suggestedCount = suggestion.strategy.count;
  const fullPrimaryLabel = translate("chat.composer.implementWithSubagents", {
    count: suggestedCount,
  });
  return {
    primaryLabel: input.compact
      ? translate("chat.composer.subagentCount", { count: suggestedCount })
      : fullPrimaryLabel,
    primaryAriaLabel: fullPrimaryLabel,
    menuActions: [
      {
        id: "standard:same-thread",
        label: translate("chat.composer.implementNormally"),
        target: "same-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: "standard:new-thread",
        label: translate("chat.composer.implementNormallyNewThread"),
        target: "new-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: `subagents:${suggestedCount}:new-thread`,
        label: translate("chat.composer.implementWithSubagentsNewThread", {
          count: suggestedCount,
        }),
        target: "new-thread",
        strategy: suggestion.strategy,
        suggested: true,
      },
      ...suggestion.supportedCounts.map((count): PlanImplementationMenuAction => ({
        id: `subagents:${count}:same-thread`,
        label: translate("chat.composer.implementWithSubagents", { count }),
        target: "same-thread",
        strategy: { kind: "subagents", count },
        suggested: count === suggestedCount,
      })),
    ],
  };
}
