import type {
  BetterT3FeatureId,
  ChatVisualMode,
  ContextWindowSelector,
  SidebarPosition,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlugIcon,
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

import "./BetterT3SettingsPreview.css";

type Translate = InterfaceTranslator["message"];

export const BETTER_T3_VISUAL_FEATURE_IDS = [
  "agent.planMode",
  "agent.generalSubagents",
  "agent.reasoningVisibility",
  "chat.sidebarPosition",
  "chat.presentation",
  "chat.contextWindowSelector",
  "chat.workspaceCardDeck",
  "chat.classicBubbleOnly",
  "chat.characterStreamingMotion",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

export type BetterT3VisualFeatureId = (typeof BETTER_T3_VISUAL_FEATURE_IDS)[number];

function FeatureVisualFrame(props: {
  readonly animationKey: string;
  readonly children: ReactNode;
  readonly featureId: BetterT3VisualFeatureId;
}) {
  return (
    <div
      className="relative flex h-36 items-center justify-center overflow-hidden bg-muted/25 p-3"
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

function AgentPromptPreview(props: {
  readonly model: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-2 rounded-lg border border-border/70 bg-card p-3 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium text-foreground">
          <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground" />
          {props.translate("settings.betterT3.preview.agent.prompt")}
        </span>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
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
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/15 bg-primary/8 px-2 py-1 text-[9px] text-primary">
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
      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[9px] text-muted-foreground">
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
            <span className="min-w-0 flex-1 truncate text-[9px] font-medium text-foreground/85">
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
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-3" />
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
            props.model.reasoningVisibility
              ? "bg-success/10 text-success"
              : "bg-muted text-muted-foreground",
          )}
        >
          {props.translate(
            props.model.reasoningVisibility
              ? "settings.betterT3.control.statusEnabled"
              : "settings.betterT3.control.statusDisabled",
          )}
        </span>
      </div>
      <div
        className={cn(
          "mt-auto rounded-lg border border-border/40 bg-muted/25 p-2",
          !props.model.reasoningVisibility && "opacity-40",
        )}
      >
        <span className="text-[9px] font-medium text-muted-foreground">
          {props.translate("settings.betterT3.preview.agent.reasoning")}
        </span>
        <div className="mt-1.5 space-y-1">
          <span className="better-t3-preview-thinking-line block h-1 w-[88%] origin-left rounded-full bg-foreground/12" />
          <span className="better-t3-preview-thinking-line block h-1 w-[61%] origin-left rounded-full bg-foreground/8" />
        </div>
      </div>
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
        <span className="text-[9px] font-medium text-muted-foreground">
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
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-1.5 rounded-lg border border-border/70 bg-card p-2 shadow-xs">
      <div className="ml-auto flex h-5 w-[48%] shrink-0 items-center rounded-md bg-primary/12 px-2">
        <span className="h-1 w-3/4 rounded-full bg-primary/30" />
      </div>
      <div
        className={cn(
          "better-t3-preview-reveal flex min-h-0 items-start gap-1.5",
          props.model.presentation === "current" &&
            "rounded-md border border-border/60 bg-muted/25 p-2",
        )}
      >
        <BotIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="truncate text-[9px] leading-3 text-foreground/80">
            {props.translate("settings.betterT3.preview.chat.response")}
          </div>
          <div className="h-1 w-[88%] rounded-full bg-foreground/15" />
          <div className="h-1 w-[62%] rounded-full bg-foreground/10" />
        </div>
      </div>
      <span className="mt-auto block h-4 shrink-0 rounded-md border border-border/60 bg-background" />
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
    >
      {props.model.workspaceCardDeck ? (
        <>
          <div className="better-t3-preview-deck-top absolute inset-x-3 top-0 flex h-16 items-start gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 pt-1.5 text-[9px] font-medium text-muted-foreground shadow-xs">
            <PlugIcon className="size-3" />
            {props.translate("settings.betterT3.preview.chat.mcp")}
            <span className="ml-auto mt-1 size-1 rounded-full bg-success" />
          </div>
          <div className="better-t3-preview-deck-bottom absolute inset-x-3 bottom-0 flex h-16 items-end gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 pb-1.5 text-[9px] font-medium text-muted-foreground shadow-xs">
            <GitBranchIcon className="size-3" />
            {props.translate("settings.betterT3.preview.chat.git")}
            <span className="ml-auto font-mono text-[8px] text-success">
              +12 <span className="text-muted-foreground">−3</span>
            </span>
          </div>
        </>
      ) : null}
      <div className="better-t3-preview-active-card relative z-10 flex h-16 w-full flex-col justify-between rounded-lg border border-border bg-background p-2.5 shadow-md shadow-black/8">
        <span className="truncate text-[10px] text-muted-foreground">
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
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 text-[9px] font-medium text-muted-foreground">
          <span className="truncate">{props.translate("chat.contextWindow.title")}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-foreground">
            272K <ChevronDownIcon className="size-2.5" />
          </span>
        </div>
        {props.selector === "native" ? (
          <div className="better-t3-preview-reveal space-y-1 text-[9px] tabular-nums">
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
            <div className="mt-1.5 flex justify-between text-[8px] tabular-nums text-muted-foreground">
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
  | ContextWindowSelector;

function visualChoiceValues(
  featureId: BetterT3VisualFeatureId,
): ReadonlyArray<BetterT3VisualChoiceValue> {
  if (featureId === "chat.sidebarPosition") return ["left", "right"];
  if (featureId === "chat.presentation") return ["current", "classic"];
  if (featureId === "chat.contextWindowSelector") return ["native", "better-t3"];
  return [false, true];
}

function visualChoiceLabel(
  featureId: BetterT3VisualFeatureId,
  value: BetterT3VisualChoiceValue,
  translate: Translate,
): string {
  if (featureId === "chat.sidebarPosition") {
    return translate(
      value === "right"
        ? "settings.betterT3.sidebarPosition.right"
        : "settings.betterT3.sidebarPosition.left",
    );
  }
  if (featureId === "chat.presentation") {
    return translate(
      value === "classic" ? "settings.betterT3.value.classic" : "settings.betterT3.value.current",
    );
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
    case "agent.generalSubagents":
      return { ...model, agent: { ...model.agent, generalSubagents: value === true } };
    case "agent.reasoningVisibility":
      return { ...model, agent: { ...model.agent, reasoningVisibility: value === true } };
    case "chat.sidebarPosition":
      return {
        ...model,
        chat: { ...model.chat, sidebarPosition: value === "right" ? "right" : "left" },
      };
    case "chat.presentation":
      return {
        ...model,
        chat: { ...model.chat, presentation: value === "classic" ? "classic" : "current" },
      };
    case "chat.workspaceCardDeck":
      return { ...model, chat: { ...model.chat, workspaceCardDeck: value === true } };
    case "chat.classicBubbleOnly":
      return { ...model, chat: { ...model.chat, composerPlanBubble: value === true } };
    case "chat.characterStreamingMotion":
      return { ...model, chat: { ...model.chat, characterStreamingMotion: value === true } };
    case "chat.contextWindowSelector":
      return {
        ...model,
        chat: { ...model.chat, contextWindowSelector: value === "native" ? "native" : "better-t3" },
      };
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
      className="grid grid-cols-1 gap-3 pb-2 pt-3 sm:grid-cols-2"
      data-better-t3-feature-choice={props.featureId}
      role="radiogroup"
    >
      {visualChoiceValues(props.featureId).map((value) => {
        const selected = value === props.value;
        return (
          <button
            aria-checked={selected}
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
              />
            </div>
            <span className="flex min-h-10 items-center justify-between gap-3 border-t border-border/50 px-3 py-2 text-xs font-medium">
              {visualChoiceLabel(props.featureId, value, props.translate)}
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
}) {
  const { agent, chat } = props.model;
  switch (props.featureId) {
    case "agent.planMode":
      return (
        <FeatureVisualFrame
          animationKey={`prompt:${agent.planMode}:${agent.promptImprovement}`}
          featureId={props.featureId}
        >
          <AgentPromptPreview model={agent} translate={props.translate} />
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
              <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-medium">
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
          animationKey={`reasoning:${agent.reasoningVisibility}:${agent.deepThinking}`}
          featureId={props.featureId}
        >
          <AgentReasoningPreview model={agent} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "chat.sidebarPosition":
      return (
        <FeatureVisualFrame
          animationKey={`sidebar:${chat.sidebarPosition}:${chat.classicSidebar}:${chat.draftIndicators}`}
          featureId={props.featureId}
        >
          <SidebarLayoutPreview model={chat} translate={props.translate} />
        </FeatureVisualFrame>
      );
    case "chat.presentation":
      return (
        <FeatureVisualFrame
          animationKey={`presentation:${chat.presentation}:${chat.characterStreamingMotion}`}
          featureId={props.featureId}
        >
          <ChatPresentationPreview model={chat} translate={props.translate} />
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
            <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground">
              <BotIcon className="size-3" />
              {props.translate("settings.betterT3.preview.live")}
            </div>
            <div className="text-[11px] leading-5 text-foreground/90">
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
            <div className="text-[9px] text-muted-foreground">
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
  }
}
