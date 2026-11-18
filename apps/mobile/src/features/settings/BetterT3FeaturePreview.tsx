import {
  BETTER_T3_VISUAL_FEATURE_IDS,
  keyedPreviewCharacters,
  type BetterT3SettingsPreviewModel,
  type BetterT3VisualFeatureId,
} from "@t3tools/client-runtime/better-t3-settings-preview";
import type { BetterT3FeatureId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadListSettingsPreview } from "./appearance/components/SettingsPreviews";
import { BetterT3PreviewFrame, PreviewReveal } from "./BetterT3PreviewFrame";

function ExampleText(props: {
  readonly message: InterfaceMessageKey;
  readonly muted?: boolean;
  readonly numberOfLines?: number;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Text
      numberOfLines={props.numberOfLines ?? 3}
      className={props.muted ? "text-xs text-foreground-muted" : "text-sm"}
    >
      {translator.message(props.message)}
    </Text>
  );
}

function ComposerPreview(props: {
  readonly expanded: boolean;
  readonly plan: boolean;
  readonly divider?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className={props.divider ? "gap-3 border-t border-border pt-3" : "gap-3"}>
      <ExampleText message="mobile.prefs.composerSample" numberOfLines={1} muted />
      <View className="flex-row items-center gap-2">
        <Text className="rounded-lg border border-border px-2 py-1 text-xs">Codex ▾</Text>
        <PreviewReveal delay={100}>
          <Text className="rounded-lg border border-border px-2 py-1 text-xs">
            {props.expanded
              ? translator.message(props.plan ? "mobile.prefs.plan" : "mobile.prefs.build")
              : "···"}
          </Text>
        </PreviewReveal>
        <Text className="ml-auto rounded-full bg-primary px-3 py-1 text-primary-foreground">↑</Text>
      </View>
    </View>
  );
}

function ReasoningPreview(props: { readonly model: BetterT3SettingsPreviewModel }) {
  const { agent } = props.model;
  const reasoning = agent.reasoningVisibility ? (
    <PreviewReveal delay={80}>
      <View
        className={
          agent.reasoningWorkingOverlay
            ? "gap-1 rounded-full border border-border bg-card px-3 py-2"
            : "gap-1 border-l-2 border-primary pl-2"
        }
      >
        {agent.reasoningWorkingOverlay ? <ExampleText message="mobile.prefs.working" /> : null}
        <ExampleText message="mobile.prefs.sampleReasoning" muted />
      </View>
    </PreviewReveal>
  ) : null;
  return (
    <View className="gap-3">
      {!agent.reasoningInMessage && !agent.reasoningWorkingOverlay ? reasoning : null}
      <PreviewReveal delay={200} className="gap-2 rounded-xl bg-card p-3">
        {agent.reasoningInMessage ? reasoning : null}
        <ExampleText message="mobile.prefs.sampleReply" />
      </PreviewReveal>
      {agent.reasoningWorkingOverlay ? reasoning : null}
    </View>
  );
}

function ChatPreview(props: { readonly model: BetterT3SettingsPreviewModel }) {
  const translator = useMobileInterfaceTranslator();
  const { chat } = props.model;
  return (
    <View className="flex-1 justify-between gap-2">
      <View className="self-end rounded-2xl bg-user-bubble px-3 py-2">
        <Text numberOfLines={2} className="text-sm text-user-bubble-foreground">
          {translator.message("mobile.prefs.samplePrompt")}
        </Text>
      </View>
      <PreviewReveal enabled={chat.presentation === "better-t3" && chat.presentationMotion}>
        <View
          className={
            chat.presentation === "better-t3"
              ? "gap-2 rounded-xl border border-border bg-card p-3"
              : chat.presentation === "classic"
                ? "gap-2 border-l-2 border-primary pl-3"
                : "gap-2 py-2"
          }
        >
          <ExampleText message="settings.betterT3.preview.chat.toolGroup" numberOfLines={1} muted />
          <ExampleText message="mobile.prefs.sampleReply" numberOfLines={2} />
        </View>
      </PreviewReveal>
      <ComposerPreview expanded={chat.expandedComposerControls} plan={props.model.agent.planMode} />
    </View>
  );
}

function SidebarPreview(props: { readonly model: BetterT3SettingsPreviewModel }) {
  const { chat } = props.model;
  return (
    <View
      className={chat.sidebarPosition === "right" ? "flex-row-reverse gap-3" : "flex-row gap-3"}
    >
      <View className="flex-1 gap-2 rounded-lg bg-card p-2">
        <Text className="font-t3-medium text-xs">better-t3code</Text>
        {(["sampleThread", "sampleThreadNew", "sampleThreadOld"] as const).map((thread, index) => (
          <PreviewReveal key={thread} delay={index * 90}>
            <View
              className={
                chat.boringSidebar
                  ? "flex-row items-center gap-1 py-0.5"
                  : chat.classicSidebar
                    ? "flex-row items-center gap-1 py-1"
                    : "flex-row items-center gap-1 rounded-lg border border-border p-2"
              }
            >
              <Text className="text-xs text-primary">{chat.boringSidebar ? "›" : "•"}</Text>
              <View className="flex-1">
                <ExampleText message={`mobile.prefs.${thread}`} muted />
              </View>
              {chat.draftIndicators && index === 1 ? (
                <View className="size-1.5 rounded-full bg-warning" />
              ) : null}
            </View>
          </PreviewReveal>
        ))}
      </View>
      <View className="w-1/4 justify-center gap-2">
        <View className="h-2 rounded-full bg-border" />
        <View className="h-2 w-3/4 rounded-full bg-border" />
      </View>
    </View>
  );
}

function CardsPreview(props: {
  readonly model: BetterT3SettingsPreviewModel;
  readonly expanded: boolean;
}) {
  const { chat } = props.model;
  return (
    <View className="flex-1 justify-end gap-2">
      {props.expanded ? (
        <PreviewReveal enabled={chat.workspaceCardDeck} zoom={chat.cardMorphing} className="gap-2">
          {chat.workspaceCardDeck ? (
            <>
              <View className="mx-4 rounded-xl border border-border bg-card px-3 py-1">
                <ExampleText message="settings.betterT3.preview.chat.mcp" muted />
              </View>
              <View className="mx-2 rounded-xl border border-border bg-card px-3 py-1">
                <ExampleText message="settings.betterT3.preview.agent.plan" muted />
              </View>
            </>
          ) : (
            <View className="flex-row gap-2">
              <ExampleText message="settings.betterT3.preview.chat.mcp" muted />
              <ExampleText message="settings.betterT3.preview.agent.plan" muted />
            </View>
          )}
        </PreviewReveal>
      ) : null}
      <View className="rounded-xl border border-border bg-card p-3">
        <ComposerPreview
          expanded={chat.expandedComposerControls}
          plan={props.model.agent.planMode}
        />
      </View>
    </View>
  );
}

function FeatureScene(props: {
  readonly featureId: BetterT3VisualFeatureId;
  readonly model: BetterT3SettingsPreviewModel;
  readonly value: unknown;
  readonly expanded: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const { agent, chat } = props.model;
  const enabled = props.value === true;
  switch (props.featureId) {
    case "agent.planMode":
      return (
        <View className="gap-3 rounded-xl border border-border bg-card p-3">
          <ComposerPreview expanded plan={agent.planMode} />
          <PreviewReveal delay={150}>
            <ExampleText
              message={
                agent.planMode ? "mobile.prefs.planDescription" : "mobile.prefs.buildDescription"
              }
              muted
            />
          </PreviewReveal>
        </View>
      );
    case "agent.promptImprovement":
      return (
        <View className="gap-2">
          <ExampleText message="mobile.prefs.samplePrompt" />
          {agent.promptImprovement ? (
            <PreviewReveal delay={180} className="gap-2">
              <Text className="text-primary">↓</Text>
              <View className="rounded-xl border border-primary p-3">
                <ExampleText message="mobile.prefs.improvedPrompt" />
              </View>
            </PreviewReveal>
          ) : null}
        </View>
      );
    case "agent.expandedComposerControls":
      return <ComposerPreview expanded={chat.expandedComposerControls} plan={agent.planMode} />;
    case "agent.reasoningVisibility":
      return <ReasoningPreview model={props.model} />;
    case "agent.generalSubagents":
    case "agent.nativeSubagentDisplay":
      return (
        <View className="gap-2">
          <ExampleText
            message={agent.generalSubagents ? "mobile.prefs.subagents" : "mobile.prefs.singleAgent"}
          />
          <View
            className={
              props.featureId === "agent.nativeSubagentDisplay" && enabled
                ? "gap-2 border-l-2 border-primary pl-3"
                : "gap-2 rounded-xl border border-border p-3"
            }
          >
            {(agent.generalSubagents
              ? (["inspect", "implement", "verify"] as const)
              : (["implement"] as const)
            ).map((step, index) => (
              <PreviewReveal key={step} delay={index * 120}>
                <ExampleText message={`mobile.prefs.${step}`} muted />
              </PreviewReveal>
            ))}
          </View>
        </View>
      );
    case "chat.sidebarPosition":
    case "chat.classicSidebar":
    case "chat.draftIndicators":
      return <SidebarPreview model={props.model} />;
    case "chat.presentation":
    case "chat.presentationMotion":
      return <ChatPreview model={props.model} />;
    case "chat.characterStreamingMotion":
      return (
        <View className="gap-3">
          <View className="flex-row flex-wrap">
            {keyedPreviewCharacters(
              translator.message("settings.betterT3.preview.chat.response"),
            ).map(({ character, key }, index) => (
              <PreviewReveal key={key} enabled={chat.characterStreamingMotion} delay={index * 28}>
                <Text className="text-sm">{character === " " ? "\u00a0" : character}</Text>
              </PreviewReveal>
            ))}
          </View>
          <ExampleText
            message={
              chat.characterStreamingMotion
                ? "settings.betterT3.preview.chat.smooth"
                : "settings.betterT3.preview.chat.instant"
            }
            muted
          />
        </View>
      );
    case "chat.workspaceCardDeck":
    case "chat.cardMorphing":
      return <CardsPreview model={props.model} expanded={props.expanded} />;
    case "chat.classicBubbleOnly":
      return (
        <View className="gap-3">
          <PreviewReveal
            className={
              chat.composerPlanBubble
                ? "rounded-xl border border-primary bg-card p-3"
                : "border-l-2 border-border pl-3"
            }
          >
            <ExampleText message="mobile.prefs.plan" />
            <ExampleText message="mobile.prefs.planDescription" muted />
          </PreviewReveal>
          {chat.composerPlanBubble ? (
            <View className="h-6 rounded-xl border border-border bg-card" />
          ) : null}
        </View>
      );
    case "chat.hideComposerDivider":
      return (
        <View className="gap-3">
          <ExampleText message="mobile.prefs.sampleReply" />
          <ComposerPreview
            expanded={chat.expandedComposerControls}
            plan={agent.planMode}
            divider={!enabled}
          />
        </View>
      );
    case "agent.contextCompaction":
      return (
        <View className="gap-2">
          <ExampleText message="mobile.prefs.contextBefore" muted />
          <View className="h-2 w-4/5 rounded-full bg-primary" />
          <PreviewReveal delay={180} className="gap-2">
            <ExampleText message="mobile.prefs.contextAfter" muted />
            <View
              className={
                enabled ? "h-2 w-1/4 rounded-full bg-primary" : "h-2 w-3/5 rounded-full bg-primary"
              }
            />
            <ExampleText
              message={
                enabled
                  ? "settings.betterT3.preview.examples.context.background"
                  : "settings.betterT3.preview.examples.context.native"
              }
              muted
            />
          </PreviewReveal>
        </View>
      );
    case "chat.messageEditing":
    case "chat.messageReplies":
      return (
        <View className="gap-3">
          <View
            className={
              props.featureId === "chat.messageEditing" && enabled && props.expanded
                ? "rounded-xl border border-primary bg-card p-3"
                : "self-end rounded-xl bg-card p-3"
            }
          >
            <ExampleText message="mobile.prefs.samplePrompt" />
          </View>
          <PreviewReveal delay={160} className="gap-2">
            {props.featureId === "chat.messageReplies" && enabled ? (
              <View className="border-l-2 border-primary pl-2">
                <ExampleText message="mobile.prefs.replyQuote" muted />
              </View>
            ) : null}
            <ExampleText message="mobile.prefs.sampleReply" />
          </PreviewReveal>
        </View>
      );
    case "chat.visualizations":
      return (
        <View className="gap-3">
          <ExampleText message="mobile.prefs.visualizationLabel" muted />
          <View className={enabled ? "flex-row items-center gap-2" : "gap-2"}>
            {(["inspect", "implement", "verify"] as const).map((step, index) => (
              <PreviewReveal
                key={step}
                delay={index * 140}
                className={
                  enabled ? "flex-1 rounded-lg border border-primary bg-card p-2" : undefined
                }
              >
                <ExampleText message={`mobile.prefs.${step}`} muted />
              </PreviewReveal>
            ))}
          </View>
        </View>
      );
    case "workspace.gitWorkbench":
      return (
        <View className="gap-2">
          <ExampleText message="mobile.prefs.gitBranch" muted />
          {enabled ? (
            <PreviewReveal delay={120} className="gap-2 rounded-lg bg-card p-3">
              <ExampleText message="mobile.prefs.gitChanges" />
              <Text className="font-mono text-xs">src/session.ts +8 −2</Text>
              <ExampleText message="mobile.prefs.gitChecks" muted />
            </PreviewReveal>
          ) : (
            <Text className="text-xs">Commit · Pull · Push</Text>
          )}
        </View>
      );
    case "voice.outputLanguage":
      return (
        <View className="gap-3">
          <View className="rounded-xl bg-card p-3">
            <ExampleText message="mobile.prefs.voiceSource" />
          </View>
          <PreviewReveal delay={180}>
            <Text className="text-primary">↓</Text>
            <ExampleText
              message={
                props.value === "english" ? "mobile.prefs.voiceResult" : "mobile.prefs.voiceSource"
              }
            />
          </PreviewReveal>
        </View>
      );
    case "chat.contextWindowSelector":
      return null;
  }
}

export function BetterT3FeaturePreview(props: {
  readonly group?: string;
  readonly model: BetterT3SettingsPreviewModel;
  readonly controls: ReadonlyArray<{ readonly id: BetterT3FeatureId; readonly value: unknown }>;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <>
      {props.controls.map((control) => {
        const featureId = BETTER_T3_VISUAL_FEATURE_IDS.find((id) => id === control.id);
        if (!featureId || featureId === "chat.contextWindowSelector") return null;
        const toggles =
          featureId === "chat.workspaceCardDeck" ||
          featureId === "chat.cardMorphing" ||
          (featureId === "chat.messageEditing" && control.value === true);
        return (
          <BetterT3PreviewFrame
            key={featureId}
            label={translator.message(`betterT3.${featureId}.label`)}
            animationKey={`${control.value}:${props.model.agent.animationKey}:${props.model.chat.animationKey}`}
            tall={featureId === "chat.presentation" || featureId === "chat.presentationMotion"}
            toggle={toggles}
          >
            {(expanded) => (
              <FeatureScene
                featureId={featureId}
                model={props.model}
                value={control.value}
                expanded={expanded}
              />
            )}
          </BetterT3PreviewFrame>
        );
      })}
      {props.group !== undefined &&
      ["sidebar-previews", "sidebar-sorting", "sidebar-cleanup"].includes(props.group) ? (
        <ThreadListSettingsPreview interactive />
      ) : null}
      {props.group === "project-indexing" ? (
        <BetterT3PreviewFrame
          label={translator.message("mobile.prefs.indexExplanation")}
          animationKey={props.controls.map((control) => `${control.id}:${control.value}`).join(":")}
        >
          {() => (
            <View className="gap-3">
              <Text className="text-center text-xl">📁 → ⌕ → ✦</Text>
              <PreviewReveal delay={180}>
                <ExampleText message="mobile.prefs.indexExplanation" />
              </PreviewReveal>
            </View>
          )}
        </BetterT3PreviewFrame>
      ) : null}
    </>
  );
}
