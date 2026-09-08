import type { BetterT3FeatureId, ChatVisualMode, SidebarPosition } from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { BotIcon, CheckIcon, MessageSquareIcon, SparklesIcon, WorkflowIcon } from "lucide-react";
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
  "chat.workspaceCardDeck",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

export type BetterT3VisualFeatureId = (typeof BETTER_T3_VISUAL_FEATURE_IDS)[number];

function FeatureVisualFrame(props: {
  readonly animationKey: string;
  readonly children: ReactNode;
  readonly featureId: BetterT3VisualFeatureId;
}) {
  return (
    <div
      className="better-t3-preview-animate relative h-28 overflow-hidden bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--primary)_7%,transparent),transparent_62%)]"
      data-better-t3-feature-visual={props.featureId}
      key={props.animationKey}
    >
      {props.children}
    </div>
  );
}

const agentRows = [
  "settings.betterT3.preview.agent.planner",
  "settings.betterT3.preview.agent.implementer",
  "settings.betterT3.preview.agent.reviewer",
] as const;

function AgentPromptPreview(props: {
  readonly model: BetterT3AgentPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div className="flex h-full flex-col justify-between gap-2 p-2.5">
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
        <span className="block h-1.5 w-[92%] rounded-full bg-foreground/12" />
        <span className="block h-1.5 w-[72%] rounded-full bg-foreground/8" />
        <span className="block h-1.5 w-[46%] rounded-full bg-foreground/8" />
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
    <div className="h-full p-2.5">
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
            className="flex min-h-5 items-center gap-1.5 rounded-md border border-border/40 bg-muted/35 px-1.5 py-1"
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
      className="flex h-full flex-col gap-2 p-2.5"
      data-deep-thinking={props.model.deepThinking && props.model.reasoningVisibility}
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
        "grid h-full",
        props.model.sidebarPosition === "left"
          ? "grid-cols-[36%_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)_36%]",
      )}
      data-position={props.model.sidebarPosition}
    >
      {props.model.sidebarPosition === "left" ? sidebar : null}
      <div className="flex min-w-0 flex-col p-2">
        <span className="text-[9px] font-medium text-muted-foreground">
          {props.translate(
            props.model.sidebarPosition === "left"
              ? "settings.betterT3.sidebarPosition.left"
              : "settings.betterT3.sidebarPosition.right",
          )}
        </span>
        <div className="mt-3 space-y-1.5">
          <span className="ml-auto block h-3 w-[48%] rounded-md bg-primary/10" />
          <span className="block h-1 w-[70%] rounded-full bg-foreground/10" />
          <span className="block h-1 w-[52%] rounded-full bg-foreground/8" />
        </div>
        <span className="mt-auto block h-5 rounded-md border border-border/50 bg-card" />
      </div>
      {props.model.sidebarPosition === "right" ? sidebar : null}
    </div>
  );
}

function ChatPresentationPreview(props: {
  readonly model: BetterT3ChatPreviewModel;
  readonly translate: Translate;
}) {
  const words = props.translate("settings.betterT3.preview.chat.response").split(" ").slice(0, 4);
  return (
    <div className="flex h-full min-w-0 flex-col p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-medium text-muted-foreground">
          {props.translate(
            props.model.presentation === "classic"
              ? "settings.betterT3.value.classic"
              : "settings.betterT3.value.current",
          )}
        </span>
        <span className="size-1.5 rounded-full bg-success" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="ml-auto h-4 w-[44%] rounded-md bg-primary/10" />
        {props.model.presentation === "classic" ? (
          <div className="space-y-1.5">
            <div className="h-1 w-[72%] rounded-full bg-foreground/10" />
            <div className="h-1 w-[58%] rounded-full bg-foreground/8" />
            <div className="h-1 w-[66%] rounded-full bg-foreground/8" />
          </div>
        ) : (
          <div className="rounded-md border border-border/40 bg-muted/25 px-2 py-1.5">
            <div className="flex flex-wrap gap-x-1 gap-y-0.5">
              {words.map((word) => (
                <span
                  className="better-t3-preview-stream-token text-[9px] text-foreground/65"
                  key={word}
                >
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <span className="mt-auto block h-5 rounded-md border border-border/50 bg-card" />
    </div>
  );
}

function WorkspaceCardDeckPreview(props: {
  readonly model: BetterT3ChatPreviewModel;
  readonly translate: Translate;
}) {
  return (
    <div className="relative flex h-full items-center justify-center px-3">
      {props.model.workspaceCardDeck ? (
        <>
          <div className="absolute inset-x-5 top-[1.65rem] h-6 rounded-t-lg border border-border/45 bg-muted/45 px-2 text-[8px] leading-5 text-muted-foreground">
            {props.translate("settings.betterT3.preview.chat.mcp")}
          </div>
          <div className="absolute inset-x-5 bottom-[1.65rem] h-6 rounded-b-lg border border-border/45 bg-muted/45 px-2 text-[8px] leading-7 text-muted-foreground">
            {props.translate("settings.betterT3.preview.chat.git")}
          </div>
        </>
      ) : null}
      <div className="better-t3-preview-active-card relative z-10 flex h-11 w-full items-center justify-between rounded-lg border border-border/55 bg-card px-2.5 shadow-sm">
        <span className="truncate text-[9px] text-muted-foreground">
          {props.translate("settings.betterT3.preview.chat.prompt")}
        </span>
        <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <MessageSquareIcon className="size-2" />
        </span>
      </div>
    </div>
  );
}

export type BetterT3VisualChoiceValue = boolean | ChatVisualMode | SidebarPosition;

function visualChoiceValues(
  featureId: BetterT3VisualFeatureId,
): ReadonlyArray<BetterT3VisualChoiceValue> {
  if (featureId === "chat.sidebarPosition") return ["left", "right"];
  if (featureId === "chat.presentation") return ["current", "classic"];
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
      className="grid grid-cols-1 gap-2 pb-2 pt-3 sm:grid-cols-2"
      data-better-t3-feature-choice={props.featureId}
      role="radiogroup"
    >
      {visualChoiceValues(props.featureId).map((value) => {
        const selected = value === props.value;
        return (
          <button
            aria-checked={selected}
            className={cn(
              "overflow-hidden rounded-xl border bg-background/65 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary/70 bg-primary/5 ring-1 ring-primary/40"
                : "border-border/60 hover:border-border hover:bg-accent/10",
            )}
            disabled={props.disabled}
            key={String(value)}
            onClick={() => props.onChange(value)}
            role="radio"
            type="button"
          >
            <span className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs font-medium">
              {visualChoiceLabel(props.featureId, value, props.translate)}
              {selected ? <CheckIcon aria-hidden className="size-3.5 text-primary" /> : null}
            </span>
            <div aria-hidden="true">
              <BetterT3FeatureVisual
                featureId={props.featureId}
                model={visualChoiceModel(props.featureId, value, props.model)}
                translate={props.translate}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function BetterT3FeatureVisual(props: {
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
          <div data-streaming-motion={chat.characterStreamingMotion} className="h-full">
            <ChatPresentationPreview model={chat} translate={props.translate} />
          </div>
        </FeatureVisualFrame>
      );
    case "chat.workspaceCardDeck":
      return (
        <FeatureVisualFrame
          animationKey={`cards:${chat.workspaceCardDeck}:${chat.cardMorphing}`}
          featureId={props.featureId}
        >
          <div data-card-morphing={chat.cardMorphing} className="h-full">
            <WorkspaceCardDeckPreview model={chat} translate={props.translate} />
          </div>
        </FeatureVisualFrame>
      );
  }
}
