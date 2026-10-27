import {
  CHAT_VISUAL_MODES,
  type BetterT3FeatureId,
  type ChatVisualMode,
  type ContextWindowSelector,
  type SidebarPosition,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  ArrowUpIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlugIcon,
  SearchIcon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import type {
  BetterT3AgentPreviewModel,
  BetterT3ChatPreviewModel,
  BetterT3SettingsPreviewModel,
} from "./BetterT3SettingsPreview.logic";

import type { ReasoningDisplayMode } from "./BetterT3SettingsPanel.logic";
import { BETTER_T3_EXAMPLE_FEATURE_IDS, BetterT3FeatureExample } from "./BetterT3SettingsExamples";

type Translate = InterfaceTranslator["message"];

export const BETTER_T3_VISUAL_FEATURE_IDS = [
  "agent.planMode",
  "agent.promptImprovement",
  "agent.generalSubagents",
  "agent.reasoningVisibility",
  "agent.expandedComposerControls",
  "chat.sidebarPosition",
  "chat.classicSidebar",
  "chat.presentation",
  "chat.contextWindowSelector",
  "chat.workspaceCardDeck",
  "chat.classicBubbleOnly",
  "chat.characterStreamingMotion",
  "chat.presentationMotion",
  "chat.cardMorphing",
  "chat.draftIndicators",
  ...BETTER_T3_EXAMPLE_FEATURE_IDS,
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

export type BetterT3VisualFeatureId = (typeof BETTER_T3_VISUAL_FEATURE_IDS)[number];

function FeatureVisualFrame(props: {
  readonly animationKey: string;
  readonly children: ReactNode;
  readonly featureId: BetterT3VisualFeatureId;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-muted/25 p-3",
        props.featureId === "chat.classicSidebar"
          ? "h-24"
          : props.featureId === "chat.presentation" || props.featureId === "chat.presentationMotion"
            ? "h-52"
            : "h-36",
      )}
      data-better-t3-feature-visual={props.featureId}
      key={props.animationKey}
    >
      <div className="relative h-full w-full max-w-80">{props.children}</div>
    </div>
  );
}

const agentRows = [
  "settings.betterT3.preview.agent.planner",
  "settings.betterT3.preview.agent.implementer",
  "settings.betterT3.preview.agent.reviewer",
] as const;

function keyedCharacters(text: string) {
  const occurrences = new Map<string, number>();
  return Array.from(text, (character) => {
    const occurrence = (occurrences.get(character) ?? 0) + 1;
    occurrences.set(character, occurrence);
    return { character, key: `${character}:${occurrence}` };
  });
}

function PromptImprovementPreview(props: {
  readonly enabled: boolean;
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-1.5 rounded-lg border border-border/70 bg-card p-2.5 shadow-xs">
      <div className="flex items-center gap-1.5 text-3xs text-muted-foreground">
        <MessageSquareIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {props.translate("settings.betterT3.preview.agent.prompt")}
        </span>
        <span>{props.translate("settings.betterT3.preview.example")}</span>
      </div>
      <p
        className={cn(
          "line-clamp-2 text-3xs leading-relaxed",
          props.enabled ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {props.translate("settings.betterT3.preview.promptImprovement.input")}
      </p>
      {props.enabled ? (
        <div className="better-t3-preview-reveal flex items-start gap-1.5 rounded-md border border-primary/15 bg-primary/8 px-2 py-1.5">
          <SparklesIcon className="mt-0.5 size-3 shrink-0 text-primary" />
          <p className="line-clamp-3 text-3xs leading-snug text-foreground">
            {props.translate("settings.betterT3.preview.promptImprovement.output")}
          </p>
        </div>
      ) : (
        <div className="flex justify-end">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ArrowUpIcon className="size-3" />
          </span>
        </div>
      )}
    </div>
  );
}

function AgentPromptPreview(props: {
  readonly model: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-2 rounded-lg border border-border/70 bg-card p-3 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-3xs font-medium text-foreground">
          <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground" />
          {props.translate("settings.betterT3.preview.agent.prompt")}
        </span>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 better-t3-preview-label font-medium text-primary">
          {props.translate(
            props.model.planMode
              ? "settings.betterT3.preview.agent.plan"
              : "settings.betterT3.preview.agent.build",
          )}
        </span>
      </div>
      <div className="space-y-1.5">
        <span className="better-t3-preview-reveal block h-1.5 w-[92%] rounded-full bg-foreground/18" />
        <span className="better-t3-preview-reveal block h-1.5 w-[72%] rounded-full bg-foreground/12" />
        <span className="better-t3-preview-reveal block h-1.5 w-[46%] rounded-full bg-foreground/12" />
      </div>
      {props.model.promptImprovement ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/15 bg-primary/8 px-2 py-1 better-t3-preview-label text-primary">
          <SparklesIcon className="size-2.5" />
          {props.translate("settings.betterT3.preview.agent.improved")}
        </span>
      ) : (
        <span className="h-5" />
      )}
    </div>
  );
}

function AgentWorkflowPreview(props: {
  readonly model: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  const rows = props.model.generalSubagents
    ? agentRows
    : (["settings.betterT3.preview.agent.agent"] as const);
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mb-1.5 flex items-center justify-between gap-1.5 better-t3-preview-label text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <WorkflowIcon className="size-2.5" />
          {props.translate("settings.betterT3.preview.agent.workflow")}
        </span>
        {props.model.projectCoordination ? (
          <span className="inline-flex items-center gap-0.5 text-success">
            <CheckIcon className="size-2.5" />
            {props.translate("settings.betterT3.preview.agent.coordinated")}
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        {rows.map((messageId, index) => (
          <div
            className="better-t3-preview-reveal flex min-h-5 items-center gap-2 rounded-md border border-border/65 bg-card px-2 py-1 shadow-xs"
            key={messageId}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full",
                index === 0 ? "bg-primary/12 text-primary" : "bg-success/10 text-success",
              )}
            >
              <BotIcon className="size-2.5" />
            </span>
            <span className="min-w-0 flex-1 truncate better-t3-preview-label font-medium text-foreground/85">
              {props.translate(messageId)}
            </span>
            <span className="size-1 rounded-full bg-success" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentReasoningPreview(props: {
  readonly model: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div
      className="flex h-full flex-col gap-2 rounded-lg border border-border/70 bg-card p-2.5 shadow-xs"
      data-reasoning-visible={props.model.reasoningVisibility}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SparklesIcon className="size-3" />
      </span>
      {props.model.reasoningVisibility ? (
        <div className="mt-auto rounded-lg border border-border/40 bg-muted/25 p-2">
          <span className="better-t3-preview-label font-medium text-muted-foreground">
            {props.translate("settings.betterT3.preview.agent.reasoning")}
          </span>
          <div className="mt-1.5 space-y-1">
            <span className="better-t3-preview-thinking-line block h-1 w-[88%] origin-left rounded-full bg-foreground/12" />
            <span className="better-t3-preview-thinking-line block h-1 w-[61%] origin-left rounded-full bg-foreground/8" />
          </div>
        </div>
      ) : (
        <p className="mt-auto better-t3-preview-label text-foreground">
          {props.translate("settings.betterT3.preview.chat.response")}
        </p>
      )}
    </div>
  );
}

function PreviewSidebar(props: {
  readonly classic: boolean;
  readonly draftIndicators: boolean;
  readonly position: BetterT3ChatPreviewModel["sidebarPosition"];
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col border-border/50 bg-muted/35 px-1.5 py-2",
        props.position === "left" ? "border-r" : "border-l",
      )}
    >
      <span className="mb-1.5 block h-1.5 w-2/3 rounded-full bg-foreground/15" />
      <div className={cn("space-y-1", props.classic && "space-y-0.5")}>
        {[0, 1, 2, 3].map((row) => (
          <span
            className={cn(
              "flex items-center gap-1 rounded px-1",
              props.classic ? "h-3.5" : "h-4.5",
              row === 0 ? "bg-primary/10" : "bg-transparent",
            )}
            key={row}
          >
            <span className="block size-1 rounded-full bg-foreground/15" />
            <span className="block h-1 flex-1 rounded-full bg-foreground/10" />
            {props.draftIndicators && row === 1 ? (
              <span className="size-1 rounded-full bg-warning" />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function SidebarLayoutPreview(props: {
  readonly model: BetterT3ChatPreviewModel;
  readonly translate: Translate;
}) {
  const sidebar = (
    <PreviewSidebar
      classic={props.model.classicSidebar}
      draftIndicators={props.model.draftIndicators}
      position={props.model.sidebarPosition}
    />
  );
  return (
    <div
      className={cn(
        "grid h-full overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs",
        props.model.sidebarPosition === "left"
          ? "grid-cols-[36%_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)_36%]",
      )}
      data-position={props.model.sidebarPosition}
    >
      {props.model.sidebarPosition === "left" ? sidebar : null}
      <div className="flex min-w-0 flex-col gap-2 p-2">
        <span className="better-t3-preview-label font-medium text-muted-foreground">
          {props.translate(
            props.model.sidebarPosition === "left"
              ? "settings.betterT3.sidebarPosition.left"
              : "settings.betterT3.sidebarPosition.right",
          )}
        </span>
        <div className="better-t3-preview-reveal space-y-1.5">
          <span className="ml-auto block h-3 w-[48%] rounded-md bg-primary/10" />
          <span className="block h-1 w-[70%] rounded-full bg-foreground/10" />
          <span className="block h-1 w-[52%] rounded-full bg-foreground/8" />
        </div>
        <span className="mt-auto block h-5 shrink-0 rounded-md border border-border/60 bg-background" />
      </div>
      {props.model.sidebarPosition === "right" ? sidebar : null}
    </div>
  );
}

function ChatPresentationPreview(props: {
  readonly model: BetterT3ChatPreviewModel;
  readonly reasoning: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  const betterT3 = props.model.presentation === "better-t3";
  const classic = props.model.presentation === "classic";
  const inlineReasoning =
    props.reasoning.reasoningVisibility &&
    !props.reasoning.reasoningWorkingOverlay &&
    !props.reasoning.reasoningInMessage;
  const workingReasoning =
    props.reasoning.reasoningVisibility && props.reasoning.reasoningWorkingOverlay;
  return (
    <div
      className="flex h-full min-w-0 flex-col rounded-lg border border-border/70 bg-background p-2 shadow-xs"
      data-chat-presentation={props.model.presentation}
      data-presentation-motion={betterT3 && props.model.presentationMotion}
      style={{ fontSize: "0.625rem" }}
    >
      <div
        className="mx-auto flex min-h-0 flex-1 flex-col gap-2"
        style={{ width: `${props.model.contentWidthPercent}%` }}
      >
        <div
          className={cn(
            "ml-auto max-w-[80%] px-2 py-1",
            betterT3
              ? "better-t3-preview-message rounded-xl bg-message text-message-foreground"
              : "rounded-lg bg-primary/12 text-primary",
          )}
        >
          <span className="block h-1 w-12 max-w-full rounded-full bg-current opacity-25" />
        </div>
        <div className="flex flex-col gap-1 text-muted-foreground">
          {inlineReasoning ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <BrainIcon className="size-3 shrink-0" />
              <span className="min-w-0 truncate">
                {props.translate("settings.betterT3.preview.chat.thought")}
              </span>
              <ChevronRightIcon className="size-2.5 shrink-0" />
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5">
            <SearchIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">
              {props.translate(
                classic
                  ? "settings.betterT3.preview.chat.tool"
                  : "settings.betterT3.preview.chat.toolGroup",
              )}
            </span>
            <ChevronRightIcon className="size-2.5 shrink-0" />
          </div>
          {classic ? (
            <span className="flex items-center gap-1 pl-4.5">
              {props.translate("settings.betterT3.preview.chat.moreTools")}
              <ChevronDownIcon className="size-2.5 shrink-0" />
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "flex min-h-0 items-start gap-1.5",
            betterT3 &&
              "better-t3-preview-message mr-auto max-w-[80%] rounded-xl bg-message px-2 py-1 text-message-foreground",
            betterT3 &&
              props.model.presentationMotion &&
              props.model.characterStreamingMotion &&
              "better-t3-preview-presentation-reveal",
          )}
        >
          {!betterT3 ? <BotIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" /> : null}
          <div className="min-w-0 flex-1 space-y-1.5">
            {props.reasoning.reasoningInMessage ? (
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <BrainIcon className="size-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {props.translate("settings.betterT3.preview.chat.thought")}
                </span>
                <ChevronRightIcon className="size-2.5 shrink-0" />
              </div>
            ) : null}
            <p className={cn("leading-relaxed", !betterT3 && "text-foreground")}>
              {props.translate("settings.betterT3.preview.chat.response")}
            </p>
            {betterT3 ? (
              <span className="inline-flex max-w-full items-center gap-1.5">
                <FileIcon className="size-3 shrink-0" />
                <span className="min-w-0 truncate font-medium">App.tsx</span>
                <span className="shrink-0 font-mono text-success">
                  +12 <span className="text-destructive">−3</span>
                </span>
              </span>
            ) : null}
          </div>
        </div>
        {workingReasoning ? (
          <div className="mt-auto flex min-w-0 items-center gap-1 rounded-lg border border-border/60 bg-card px-1.5 py-1 text-muted-foreground">
            <span>{props.translate("chat.timeline.working")}</span>
            <span className="truncate">
              {props.translate("settings.betterT3.preview.reasoning.current")}
            </span>
          </div>
        ) : null}
      </div>
      <span className="mt-2 block h-4 shrink-0 rounded-md border border-border/60 bg-card" />
    </div>
  );
}

function WorkspaceCardDeckPreview(props: {
  readonly model: BetterT3ChatPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div
      className="relative mx-auto flex h-full max-w-72 items-center justify-center"
      data-workspace-card-deck={props.model.workspaceCardDeck}
      data-card-morphing={props.model.cardMorphing}
    >
      {props.model.workspaceCardDeck ? (
        <>
          <div className="better-t3-preview-deck-top absolute inset-x-3 top-0 flex h-16 items-start gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 pt-1.5 better-t3-preview-label font-medium text-muted-foreground shadow-xs">
            <PlugIcon className="size-3" />
            {props.translate("settings.betterT3.preview.chat.mcp")}
            <span className="ml-auto mt-1 size-1 rounded-full bg-success" />
          </div>
          <div className="better-t3-preview-deck-bottom absolute inset-x-3 bottom-0 flex h-16 items-end gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 pb-1.5 better-t3-preview-label font-medium text-muted-foreground shadow-xs">
            <GitBranchIcon className="size-3" />
            {props.translate("settings.betterT3.preview.chat.git")}
            <span className="ml-auto font-mono text-4xs text-success">
              +12 <span className="text-muted-foreground">−3</span>
            </span>
          </div>
        </>
      ) : null}
      <div className="better-t3-preview-active-card relative z-10 flex h-16 w-full flex-col justify-between rounded-lg border border-border bg-background p-2.5 shadow-md shadow-black/8">
        <span className="truncate text-3xs text-muted-foreground">
          {props.translate("settings.betterT3.preview.chat.prompt")}
        </span>
        <div className="flex items-center justify-between">
          <MessageSquareIcon className="size-3 text-muted-foreground" />
          <span className="flex size-4 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ArrowUpIcon className="size-2.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

function ContextWindowSelectorPreview(props: {
  readonly selector: ContextWindowSelector;
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-64 rounded-lg border border-border/70 bg-card p-2.5 shadow-xs">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 better-t3-preview-label font-medium text-muted-foreground">
          <span className="truncate">{props.translate("chat.contextWindow.title")}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-foreground">
            272K <ChevronDownIcon className="size-2.5" />
          </span>
        </div>
        {props.selector === "native" ? (
          <div className="better-t3-preview-reveal space-y-1 better-t3-preview-label tabular-nums">
            <div className="flex items-center justify-between rounded bg-primary/10 px-1.5 py-1 text-primary">
              <span>272K</span>
              <CheckIcon className="size-2.5" />
            </div>
            <div className="px-1.5 text-muted-foreground">1M</div>
          </div>
        ) : (
          <div className="rounded-md border border-border/40 bg-muted/25 px-2 py-1.5">
            <div className="mb-2 text-sm font-semibold tabular-nums text-foreground">272K</div>
            <div className="relative h-1 rounded-full bg-muted">
              <span className="better-t3-preview-slider-fill absolute inset-y-0 left-0 w-1/4 origin-left rounded-full bg-primary" />
              <span className="better-t3-preview-slider-thumb absolute inset-0">
                <span className="absolute left-1/4 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40 bg-background shadow-sm" />
              </span>
            </div>
            <div className="mt-1.5 flex justify-between text-4xs tabular-nums text-muted-foreground">
              <span>16K</span>
              <span>1M</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type BetterT3VisualChoiceValue =
  | boolean
  | ChatVisualMode
  | SidebarPosition
  | ContextWindowSelector
  | ReasoningDisplayMode
  | "english";

function visualChoiceValues(
  featureId: BetterT3VisualFeatureId,
): ReadonlyArray<BetterT3VisualChoiceValue> {
  if (featureId === "agent.reasoningVisibility") return ["none", "chat", "working", "message"];
  if (featureId === "voice.outputLanguage") return ["native", "english"];
  if (featureId === "chat.sidebarPosition") return ["left", "right"];
  if (featureId === "chat.presentation") return CHAT_VISUAL_MODES;
  if (featureId === "chat.contextWindowSelector") return ["native", "better-t3"];
  return [false, true];
}

function visualChoiceLabel(
  featureId: BetterT3VisualFeatureId,
  value: BetterT3VisualChoiceValue,
  translate: Translate,
): string {
  if (featureId === "agent.nativeSubagentDisplay") {
    return translate(
      value === true
        ? "settings.betterT3.preview.examples.agents.panel"
        : "settings.betterT3.preview.examples.agents.floating",
    );
  }
  if (featureId === "agent.contextCompaction") {
    return translate(
      value === true
        ? "settings.betterT3.preview.examples.context.background"
        : "settings.betterT3.preview.examples.context.native",
    );
  }
  if (featureId === "voice.outputLanguage") {
    return translate(
      value === "english"
        ? "settings.betterT3.value.english"
        : "settings.betterT3.value.nativeLanguage",
    );
  }
  if (featureId === "workspace.gitWorkbench") {
    return translate(
      value === true
        ? "betterT3.workspace.gitWorkbench.label"
        : "settings.betterT3.preview.examples.git.compact",
    );
  }
  if (featureId === "chat.hideComposerDivider") {
    return translate(
      value === true
        ? "settings.betterT3.preview.examples.divider.hidden"
        : "settings.betterT3.preview.examples.divider.visible",
    );
  }
  if (featureId === "agent.promptImprovement") {
    return translate(
      value === true
        ? "settings.betterT3.preview.promptImprovement.improved"
        : "settings.betterT3.preview.promptImprovement.original",
    );
  }
  if (featureId === "agent.reasoningVisibility") {
    return translate(
      value === "none"
        ? "settings.betterT3.reasoning.none"
        : value === "working"
          ? "settings.betterT3.reasoning.working"
          : value === "message"
            ? "settings.betterT3.reasoning.message"
            : "settings.betterT3.reasoning.chat",
    );
  }
  if (featureId === "chat.sidebarPosition") {
    return translate(
      value === "right"
        ? "settings.betterT3.sidebarPosition.right"
        : "settings.betterT3.sidebarPosition.left",
    );
  }
  if (featureId === "chat.presentation") {
    const mode = CHAT_VISUAL_MODES.find((mode) => mode === value) ?? "current";
    return translate(`settings.chatVisuals.${mode}`);
  }
  if (featureId === "chat.contextWindowSelector") {
    return translate(
      value === "better-t3"
        ? "settings.betterT3.value.better-t3"
        : "settings.betterT3.value.native",
    );
  }
  if (featureId === "chat.classicBubbleOnly") {
    return translate(
      value === true ? "settings.betterT3.value.planBubble" : "settings.betterT3.value.native",
    );
  }
  return translate(
    value === true
      ? "settings.betterT3.control.statusEnabled"
      : "settings.betterT3.control.statusDisabled",
  );
}

function visualChoiceModel(
  featureId: BetterT3VisualFeatureId,
  value: BetterT3VisualChoiceValue,
  model: BetterT3SettingsPreviewModel,
): BetterT3SettingsPreviewModel {
  switch (featureId) {
    case "agent.planMode":
      return { ...model, agent: { ...model.agent, planMode: value === true } };
    case "agent.promptImprovement":
      return { ...model, agent: { ...model.agent, promptImprovement: value === true } };
    case "agent.expandedComposerControls":
      return { ...model, chat: { ...model.chat, expandedComposerControls: value === true } };
    case "agent.generalSubagents":
      return { ...model, agent: { ...model.agent, generalSubagents: value === true } };
    case "agent.reasoningVisibility":
      return {
        ...model,
        agent: {
          ...model.agent,
          reasoningVisibility: value !== "none",
          reasoningWorkingOverlay: value === "working",
          reasoningInMessage: value === "message",
        },
      };
    case "chat.sidebarPosition":
      return {
        ...model,
        chat: { ...model.chat, sidebarPosition: value === "right" ? "right" : "left" },
      };
    case "chat.classicSidebar":
      return { ...model, chat: { ...model.chat, classicSidebar: value === true } };
    case "chat.cardMorphing":
      return {
        ...model,
        chat: { ...model.chat, workspaceCardDeck: true, cardMorphing: value === true },
      };
    case "chat.draftIndicators":
      return { ...model, chat: { ...model.chat, draftIndicators: value === true } };
    case "chat.presentation":
      return {
        ...model,
        chat: {
          ...model.chat,
          presentation: CHAT_VISUAL_MODES.find((mode) => mode === value) ?? "current",
        },
      };
    case "chat.workspaceCardDeck":
      return { ...model, chat: { ...model.chat, workspaceCardDeck: value === true } };
    case "chat.classicBubbleOnly":
      return { ...model, chat: { ...model.chat, composerPlanBubble: value === true } };
    case "chat.characterStreamingMotion":
      return { ...model, chat: { ...model.chat, characterStreamingMotion: value === true } };
    case "chat.presentationMotion":
      return { ...model, chat: { ...model.chat, presentationMotion: value === true } };
    case "chat.contextWindowSelector":
      return {
        ...model,
        chat: { ...model.chat, contextWindowSelector: value === "native" ? "native" : "better-t3" },
      };
    default:
      return model;
  }
}

export function BetterT3FeatureChoice(props: {
  readonly disabled: boolean;
  readonly featureId: BetterT3VisualFeatureId;
  readonly model: BetterT3SettingsPreviewModel;
  readonly onChange: (value: BetterT3VisualChoiceValue) => void;
  readonly translate: Translate;
  readonly value: BetterT3VisualChoiceValue;
}) {
  return (
    <div
      aria-label={props.translate(`betterT3.${props.featureId}.label`)}
      className={cn(
        "grid grid-cols-1 gap-3 pb-2 pt-3 sm:grid-cols-2",
        props.featureId === "chat.presentation" && "lg:grid-cols-3",
        props.featureId === "agent.reasoningVisibility" && "xl:grid-cols-4",
      )}
      data-better-t3-feature-choice={props.featureId}
      role="radiogroup"
    >
      {visualChoiceValues(props.featureId).map((value) => {
        const selected = value === props.value;
        const label = visualChoiceLabel(props.featureId, value, props.translate);
        const description =
          props.featureId === "agent.contextCompaction"
            ? props.translate(
                value === true
                  ? "settings.betterT3.compaction.betterT3Description"
                  : "settings.betterT3.compaction.codexDescription",
              )
            : props.featureId === "chat.presentation"
              ? props.translate(
                  `settings.chatVisuals.${CHAT_VISUAL_MODES.find((mode) => mode === value) ?? "current"}.description`,
                )
              : undefined;
        return (
          <button
            aria-checked={selected}
            aria-description={description}
            aria-label={label}
            className={cn(
              "better-t3-feature-option min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "border-primary/65" : "border-border/70 enabled:hover:border-primary/35",
            )}
            disabled={props.disabled}
            key={String(value)}
            onClick={() => props.onChange(value)}
            role="radio"
            type="button"
          >
            <div aria-hidden="true">
              <BetterT3FeatureVisual
                featureId={props.featureId}
                model={visualChoiceModel(props.featureId, value, props.model)}
                translate={props.translate}
                value={value}
              />
            </div>
            <span className="flex min-h-10 items-center justify-between gap-3 border-t border-border/50 px-3 py-2 text-xs font-medium">
              {label}
              <span
                aria-hidden="true"
                className={cn(
                  "better-t3-preview-selection flex size-4 shrink-0 items-center justify-center rounded-full border",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/35 bg-background",
                )}
              >
                {selected ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
              </span>
            </span>
            {description ? (
              <span className="block px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
                {description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function BetterT3FeatureVisual(props: {
  readonly featureId: BetterT3VisualFeatureId;
  readonly model: BetterT3SettingsPreviewModel;
  readonly translate: Translate;
  readonly value: BetterT3VisualChoiceValue;
}) {
  const { agent, chat } = props.model;
  switch (props.featureId) {
    case "agent.promptImprovement":
      return (
        <FeatureVisualFrame
          animationKey={`prompt-improvement:${agent.promptImprovement}`}
          featureId={props.featureId}
        >
          <PromptImprovementPreview enabled={agent.promptImprovement} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "agent.planMode":
      return (
        <FeatureVisualFrame
          animationKey={`prompt:${agent.planMode}:${agent.promptImprovement}`}
          featureId={props.featureId}
        >
          <AgentPromptPreview model={agent} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "agent.expandedComposerControls":
      return (
        <FeatureVisualFrame
          animationKey={`composer-controls:${chat.expandedComposerControls}`}
          featureId={props.featureId}
        >
          <div className="flex h-full flex-col justify-between rounded-lg border border-border/70 bg-card p-3 shadow-xs">
            <span className="better-t3-preview-label text-muted-foreground">
              {props.translate("settings.betterT3.preview.chat.prompt")}
            </span>
            <div className="flex items-center gap-1">
              <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 better-t3-preview-label">
                <BotIcon className="size-2.5" />
                <span className="h-1.5 w-5 rounded-full bg-current opacity-45" />
                <ChevronDownIcon className="size-2.5 text-muted-foreground" />
              </span>
              {chat.expandedComposerControls ? (
                <>
                  <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 better-t3-preview-label">
                    <WorkflowIcon className="size-2.5" />
                    {props.translate("settings.betterT3.preview.agent.plan")}
                  </span>
                  <span className="inline-flex h-5 items-center rounded-md border border-border/70 bg-background px-1.5 better-t3-preview-label">
                    {props.translate("settings.betterT3.preview.agent.build")}
                  </span>
                </>
              ) : (
                <span className="flex size-5 items-center justify-center rounded-md border border-border/70 bg-background text-xs">
                  ···
                </span>
              )}
              <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <ArrowUpIcon className="size-2.5" />
              </span>
            </div>
          </div>
        </FeatureVisualFrame>
      );
    case "chat.classicBubbleOnly":
      return (
        <FeatureVisualFrame
          animationKey={`plan-bubble:${chat.composerPlanBubble}`}
          featureId={props.featureId}
        >
          <div className="flex h-full flex-col justify-center gap-2 px-4 py-3">
            <div
              className={cn(
                "better-t3-preview-reveal rounded-lg border px-3 py-2 shadow-xs",
                chat.composerPlanBubble
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-border/60 bg-muted/30 text-foreground/75",
              )}
            >
              <div className="mb-1.5 flex items-center gap-1.5 better-t3-preview-label font-medium">
                <CheckIcon className="size-3" />
                {props.translate("settings.betterT3.preview.agent.plan")}
              </div>
              <div className="space-y-1">
                <span className="block h-1 w-[88%] rounded-full bg-current opacity-25" />
                <span className="block h-1 w-[64%] rounded-full bg-current opacity-20" />
              </div>
            </div>
            {chat.composerPlanBubble ? (
              <div className="mx-2 h-7 rounded-lg border border-border/55 bg-card shadow-sm" />
            ) : null}
          </div>
        </FeatureVisualFrame>
      );
    case "chat.classicSidebar":
      return (
        <FeatureVisualFrame
          animationKey={`classic-sidebar:${chat.classicSidebar}:${chat.sidebarPosition}`}
          featureId={props.featureId}
        >
          <SidebarLayoutPreview model={chat} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "agent.generalSubagents":
      return (
        <FeatureVisualFrame
          animationKey={`workflow:${agent.generalSubagents}:${agent.projectCoordination}`}
          featureId={props.featureId}
        >
          <AgentWorkflowPreview model={agent} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "agent.reasoningVisibility":
      return (
        <FeatureVisualFrame
          animationKey={`reasoning:${agent.reasoningVisibility}:${agent.reasoningWorkingOverlay}:${agent.reasoningInMessage}`}
          featureId={props.featureId}
        >
          {agent.reasoningInMessage ? (
            <ChatPresentationPreview model={chat} reasoning={agent} translate={props.translate} />
          ) : agent.reasoningWorkingOverlay ? (
            <div className="flex h-full flex-col justify-end gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-xs">
                <span className="shrink-0 better-t3-preview-label text-muted-foreground">
                  {props.translate("chat.timeline.working")}
                </span>
                <span className="better-t3-preview-reveal min-w-0 flex-1 truncate text-center better-t3-preview-label text-foreground">
                  {props.translate("settings.betterT3.preview.reasoning.current")}
                </span>
                <span aria-hidden className="flex shrink-0 gap-1">
                  <span className="h-3 w-4 rounded-sm border border-primary/40" />
                  <span className="h-3 w-4 rounded-sm border border-primary/40" />
                </span>
              </div>
              <div className="h-5 rounded-lg border border-border/60 bg-card" />
            </div>
          ) : (
            <AgentReasoningPreview model={agent} translate={props.translate} />
          )}
        </FeatureVisualFrame>
      );
    case "chat.sidebarPosition":
    case "chat.draftIndicators":
      return (
        <FeatureVisualFrame
          animationKey={`sidebar:${chat.sidebarPosition}:${chat.classicSidebar}:${chat.draftIndicators}`}
          featureId={props.featureId}
        >
          <SidebarLayoutPreview model={chat} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "chat.presentation":
    case "chat.presentationMotion":
      return (
        <FeatureVisualFrame
          animationKey={`presentation:${chat.presentation}:${chat.presentationMotion}:${agent.reasoningVisibility}:${agent.reasoningWorkingOverlay}`}
          featureId={props.featureId}
        >
          <ChatPresentationPreview model={chat} reasoning={agent} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "chat.characterStreamingMotion":
      return (
        <FeatureVisualFrame
          animationKey={`streaming:${chat.characterStreamingMotion}`}
          featureId={props.featureId}
        >
          <div
            className="flex h-full flex-col justify-between rounded-lg border border-border/70 bg-card p-3 shadow-xs"
            data-streaming-motion={chat.characterStreamingMotion}
          >
            <div className="flex items-center gap-1.5 better-t3-preview-label font-medium text-muted-foreground">
              <BotIcon className="size-3" />
              {props.translate("settings.betterT3.preview.live")}
            </div>
            <div className="text-2xs leading-5 text-foreground/90">
              {chat.characterStreamingMotion ? (
                <>
                  {keyedCharacters(props.translate("settings.betterT3.preview.chat.response")).map(
                    ({ character, key }, index) => (
                      <span
                        className="better-t3-preview-stream-character inline-block whitespace-pre"
                        key={key}
                        style={{ animationDelay: `${index * 28}ms` }}
                      >
                        {character}
                      </span>
                    ),
                  )}
                  <span className="better-t3-preview-caret ml-0.5 inline-block h-3 w-px translate-y-0.5 rounded-full bg-primary" />
                </>
              ) : (
                props.translate("settings.betterT3.preview.chat.response")
              )}
            </div>
            <div className="better-t3-preview-label text-muted-foreground">
              {props.translate(
                chat.characterStreamingMotion
                  ? "settings.betterT3.preview.chat.smooth"
                  : "settings.betterT3.preview.chat.instant",
              )}
            </div>
          </div>
        </FeatureVisualFrame>
      );
    case "chat.workspaceCardDeck":
    case "chat.cardMorphing":
      return (
        <FeatureVisualFrame
          animationKey={`cards:${chat.workspaceCardDeck}:${chat.cardMorphing}`}
          featureId={props.featureId}
        >
          <WorkspaceCardDeckPreview model={chat} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "chat.contextWindowSelector":
      return (
        <FeatureVisualFrame
          animationKey={`context-window:${chat.contextWindowSelector}`}
          featureId={props.featureId}
        >
          <ContextWindowSelectorPreview
            selector={chat.contextWindowSelector}
            translate={props.translate}
          />
        </FeatureVisualFrame>
      );
    default:
      return (
        <FeatureVisualFrame
          animationKey={`${props.featureId}:${props.value}`}
          featureId={props.featureId}
        >
          <BetterT3FeatureExample
            featureId={props.featureId}
            value={props.value}
            translate={props.translate}
          />
        </FeatureVisualFrame>
      );
  }
}
