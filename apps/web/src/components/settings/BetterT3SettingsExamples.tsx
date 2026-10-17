import type { BetterT3FeatureId } from "@t3tools/contracts";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  ArchiveIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BotIcon,
  FileCodeIcon,
  GitBranchIcon,
  MessageSquareIcon,
  MicIcon,
  PencilIcon,
  QuoteIcon,
  SparklesIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

type Translate = InterfaceTranslator["message"];

export const BETTER_T3_EXAMPLE_FEATURE_IDS = [
  "agent.contextCompaction",
  "agent.nativeSubagentDisplay",
  "chat.hideComposerDivider",
  "chat.messageEditing",
  "chat.messageReplies",
  "chat.visualizations",
  "workspace.gitWorkbench",
  "voice.outputLanguage",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

function PreviewWindow(props: { title: string; translate: Translate; children: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-card p-2.5 shadow-xs">
      <div className="flex items-center justify-between gap-2 text-3xs text-muted-foreground">
        <span className="truncate font-medium">{props.title}</span>
        <span className="shrink-0">{props.translate("settings.betterT3.preview.example")}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-1.5">
        {props.children}
      </div>
    </div>
  );
}

function MessageLines() {
  return (
    <div className="space-y-1.5">
      <span className="block h-1.5 w-4/5 rounded-full bg-foreground/15" />
      <span className="block h-1.5 w-full rounded-full bg-foreground/10" />
      <span className="block h-1.5 w-3/5 rounded-full bg-foreground/10" />
    </div>
  );
}

function AgentDisplayExample({ native, translate }: { native: boolean; translate: Translate }) {
  return (
    <PreviewWindow
      title={translate("settings.betterT3.preview.agent.workflow")}
      translate={translate}
    >
      {native ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-2">
          <MessageLines />
          <div className="space-y-1 border-l border-border/70 pl-2">
            {(
              [
                "settings.betterT3.preview.agent.planner",
                "settings.betterT3.preview.agent.reviewer",
              ] as const
            ).map((key) => (
              <div className="flex items-center gap-1 text-3xs" key={key}>
                <BotIcon className="size-3 shrink-0 text-primary" />
                <span className="truncate">{translate(key)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <MessageLines />
          <div className="mt-1 flex w-fit items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-3xs text-primary">
            <BotIcon className="size-3" />
            {translate("settings.betterT3.preview.examples.agents.floating")}
            <span className="size-1 rounded-full bg-success" />
          </div>
        </>
      )}
    </PreviewWindow>
  );
}

function ContextExample({ enabled, translate }: { enabled: boolean; translate: Translate }) {
  return (
    <PreviewWindow
      title={translate("settings.betterT3.preview.examples.context.title")}
      translate={translate}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <MessageLines />
          <MessageLines />
        </div>
        <ArrowRightIcon className="size-3 text-muted-foreground" />
        <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
          {enabled ? (
            <div className="better-t3-preview-reveal flex items-center gap-1 text-3xs text-primary">
              <SparklesIcon className="size-3 shrink-0" />
              <span className="truncate">
                {translate("settings.betterT3.preview.examples.context.summary")}
              </span>
            </div>
          ) : null}
          <MessageLines />
        </div>
      </div>
      <span className="text-4xs text-muted-foreground">
        {translate("settings.betterT3.preview.examples.context.preserved")}
      </span>
    </PreviewWindow>
  );
}

function DividerExample({ hidden, translate }: { hidden: boolean; translate: Translate }) {
  return (
    <PreviewWindow title={translate("settings.betterT3.tab.composer")} translate={translate}>
      <MessageLines />
      <div className={cn("mt-1 pt-2", !hidden && "border-t border-border")}>
        <div className="flex items-center justify-between rounded-md border border-border/70 bg-background p-2 text-3xs text-muted-foreground">
          {translate("settings.betterT3.preview.chat.prompt")}
          <ArrowUpIcon className="size-3 text-primary" />
        </div>
      </div>
    </PreviewWindow>
  );
}

function MessageExample({
  editing,
  enabled,
  translate,
}: {
  editing: boolean;
  enabled: boolean;
  translate: Translate;
}) {
  return (
    <PreviewWindow
      title={translate(
        editing ? "betterT3.chat.messageEditing.label" : "betterT3.chat.messageReplies.label",
      )}
      translate={translate}
    >
      <div
        className={cn(
          "ml-auto flex max-w-[90%] items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1.5 text-3xs",
          editing && enabled && "border border-primary/40 bg-background",
        )}
      >
        {translate("settings.betterT3.preview.examples.chat.request")}
        {editing && enabled ? <PencilIcon className="size-3 shrink-0 text-primary" /> : null}
      </div>
      {!editing ? (
        <div className="rounded-md border border-border/70 p-1.5 text-3xs">
          {enabled ? (
            <div className="mb-1 flex items-center gap-1 border-l-2 border-primary/60 pl-1 text-muted-foreground">
              <QuoteIcon className="size-2.5 shrink-0" />
              <span className="truncate">
                {translate("settings.betterT3.preview.examples.chat.request")}
              </span>
            </div>
          ) : null}
          {translate("settings.betterT3.preview.examples.chat.reply")}
        </div>
      ) : (
        <MessageLines />
      )}
    </PreviewWindow>
  );
}

function DiagramExample({ enabled, translate }: { enabled: boolean; translate: Translate }) {
  const steps = [
    "settings.betterT3.preview.agent.plan",
    "settings.betterT3.preview.examples.flow.code",
    "settings.betterT3.preview.examples.flow.tests",
  ] as const;
  return (
    <PreviewWindow title={translate("betterT3.chat.visualizations.label")} translate={translate}>
      {enabled ? (
        <div className="flex items-center gap-1">
          {steps.map((step, index) => (
            <div className="flex min-w-0 flex-1 items-center gap-1" key={step}>
              {index > 0 ? (
                <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="flex min-h-8 min-w-0 flex-1 items-center justify-center rounded-md border border-primary/25 bg-primary/5 px-1 text-center text-3xs">
                {translate(step)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <ol className="space-y-1 text-3xs">
          {steps.map((step, index) => (
            <li key={step}>
              {index + 1}. {translate(step)}
            </li>
          ))}
        </ol>
      )}
    </PreviewWindow>
  );
}

function GitExample({ enabled, translate }: { enabled: boolean; translate: Translate }) {
  return (
    <PreviewWindow title={translate("betterT3.workspace.gitWorkbench.label")} translate={translate}>
      <div className="flex items-center gap-1 text-3xs">
        <GitBranchIcon className="size-3 text-muted-foreground" />
        <span>main</span>
      </div>
      {enabled ? (
        <div className="rounded-md border border-border/70">
          <div className="flex gap-3 border-b border-border/60 px-2 py-1 text-3xs">
            <span className="text-primary">{translate("git.workbench.tab.changes")}</span>
            <span className="text-muted-foreground">{translate("git.workbench.tab.history")}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 text-3xs">
            <FileCodeIcon className="size-3 text-muted-foreground" />
            <span>app.tsx</span>
            <span className="ml-auto size-1 rounded-full bg-success" />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 text-3xs">
          {["Commit", "Pull", "Push"].map((action) => (
            <span className="rounded-md border border-border/70 px-2 py-1" key={action}>
              {action}
            </span>
          ))}
        </div>
      )}
    </PreviewWindow>
  );
}

function VoiceExample({ english, translate }: { english: boolean; translate: Translate }) {
  return (
    <PreviewWindow
      title={translate("settings.betterT3.preview.examples.voice.title")}
      translate={translate}
    >
      <div className="flex items-center gap-1.5 text-3xs text-muted-foreground">
        <MicIcon className="size-3 shrink-0" />
        <span>Behebe den Login-Fehler.</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 p-2 text-3xs">
        <ArrowRightIcon className="size-3 shrink-0 text-primary" />
        <span>{english ? "Fix the login bug." : "Behebe den Login-Fehler."}</span>
      </div>
    </PreviewWindow>
  );
}

export function BetterT3FeatureExample(props: {
  featureId: (typeof BETTER_T3_EXAMPLE_FEATURE_IDS)[number];
  value: boolean | string;
  translate: Translate;
}) {
  const enabled = props.value === true;
  switch (props.featureId) {
    case "agent.nativeSubagentDisplay":
      return <AgentDisplayExample native={enabled} translate={props.translate} />;
    case "agent.contextCompaction":
      return <ContextExample enabled={enabled} translate={props.translate} />;
    case "chat.hideComposerDivider":
      return <DividerExample hidden={enabled} translate={props.translate} />;
    case "chat.messageEditing":
      return <MessageExample editing enabled={enabled} translate={props.translate} />;
    case "chat.messageReplies":
      return <MessageExample editing={false} enabled={enabled} translate={props.translate} />;
    case "chat.visualizations":
      return <DiagramExample enabled={enabled} translate={props.translate} />;
    case "workspace.gitWorkbench":
      return <GitExample enabled={enabled} translate={props.translate} />;
    case "voice.outputLanguage":
      return <VoiceExample english={props.value === "english"} translate={props.translate} />;
    default:
      return null;
  }
}

export function ProjectIndexingPreview({ translate }: { translate: Translate }) {
  const steps = [
    "settings.betterT3.preview.examples.index.files",
    "settings.betterT3.preview.examples.index.facts",
    "settings.betterT3.preview.examples.index.context",
  ] as const;
  return (
    <figure className="rounded-xl border border-border/70 bg-muted/25 p-3">
      <figcaption className="mb-3 flex items-center justify-between gap-2 text-xs font-medium">
        <span>{translate("settings.betterT3.preview.examples.index.title")}</span>
        <span className="font-normal text-muted-foreground">
          {translate("settings.betterT3.preview.example")}
        </span>
      </figcaption>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {steps.map((step, index) => (
          <div className="flex items-center gap-2" key={step}>
            {index > 0 ? <ArrowRightIcon className="size-4 text-muted-foreground" /> : null}
            <span className="rounded-lg border border-border/70 bg-card px-3 py-2 text-xs">
              {translate(step)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {translate("settings.betterT3.preview.examples.index.description")}
      </p>
    </figure>
  );
}

export function SidebarSettingsPreview(props: {
  previewCount: number;
  projectOrder: SidebarProjectSortOrder;
  threadOrder: SidebarThreadSortOrder;
  settleAfterDays: number | null;
  settleOnMerge: boolean;
  draftIndicators: boolean;
  translate: Translate;
}) {
  const projects = {
    updated_at: ["API", "Web", "Studio"],
    created_at: ["Studio", "API", "Web"],
    manual: ["Web", "Studio", "API"],
  }[props.projectOrder];
  const threads =
    props.threadOrder === "updated_at"
      ? (["recent", "merged", "inactive", "earlier"] as const)
      : (["earlier", "inactive", "merged", "recent"] as const);
  const settled = threads.filter(
    (thread) =>
      (thread === "merged" && props.settleOnMerge) ||
      (thread === "inactive" && props.settleAfterDays !== null && props.settleAfterDays <= 30),
  );
  const active = threads.filter((thread) => !settled.includes(thread));
  const visible = active.slice(0, Math.max(0, props.previewCount));
  return (
    <figure className="mb-4 rounded-xl border border-border/70 bg-muted/25 p-3">
      <figcaption className="mb-3 flex items-center justify-between gap-2 text-xs font-medium">
        <span>{props.translate("settings.betterT3.preview.examples.sidebar.title")}</span>
        <span className="font-normal text-muted-foreground">
          {props.translate("settings.betterT3.preview.example")}
        </span>
      </figcaption>
      <div className="grid gap-2 sm:grid-cols-3">
        {projects.map((project) => (
          <div className="min-w-0 rounded-lg border border-border/70 bg-card p-2" key={project}>
            <span className="mb-1.5 block text-xs font-medium">{project}</span>
            {visible.map((thread) => (
              <div className="flex min-h-6 items-center gap-1.5 text-3xs" key={thread}>
                <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {props.translate(`settings.betterT3.preview.examples.sidebar.${thread}`)}
                </span>
                {props.draftIndicators && thread === "recent" ? (
                  <span
                    className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                    role="img"
                    aria-label={props.translate("betterT3.chat.draftIndicators.label")}
                  />
                ) : null}
              </div>
            ))}
            {active.length > visible.length ? (
              <span className="block text-3xs text-muted-foreground">
                {props.translate("settings.betterT3.preview.examples.sidebar.more", {
                  count: active.length - visible.length,
                })}
              </span>
            ) : null}
            {settled.length > 0 ? (
              <div className="mt-1 flex items-center gap-1 border-t border-border/60 pt-1 text-3xs text-muted-foreground">
                <ArchiveIcon className="size-3" />
                {props.translate("settings.betterT3.preview.examples.sidebar.settled", {
                  count: settled.length,
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {props.translate("settings.betterT3.preview.examples.sidebar.description", {
          count: props.previewCount,
        })}
      </p>
    </figure>
  );
}
