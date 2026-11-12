import type { BetterT3SettingsPreviewModel } from "@t3tools/client-runtime/better-t3-settings-preview";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import {
  ChatPresentationSettingsPreview,
  ThreadListSettingsPreview,
} from "./appearance/components/SettingsPreviews";
import { useAppearancePreferences } from "./appearance/AppearancePreferencesProvider";

function PreviewFrame(props: { readonly children: ReactNode }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-3 border-t border-border-subtle p-4">
      <Text className="text-xs text-foreground-muted">
        {translator.message("mobile.prefs.preview")}
      </Text>
      <View className="gap-3 rounded-xl bg-screen p-3">{props.children}</View>
    </View>
  );
}

function ExampleText(props: { readonly message: InterfaceMessageKey; readonly muted?: boolean }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Text className={props.muted ? "text-xs text-foreground-muted" : "text-sm"}>
      {translator.message(props.message)}
    </Text>
  );
}

function VisualizationSettingsPreview() {
  const translator = useMobileInterfaceTranslator();
  const [count, setCount] = useState(3);
  return (
    <View className="gap-3">
      <ExampleText message="mobile.prefs.visualizationLabel" muted />
      <View
        className="h-14 flex-row items-end gap-2"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[
          { id: "first", value: 2 },
          { id: "second", value: 4 },
          { id: "current", value: count },
        ].map(({ id, value }) => (
          <View key={id} className="flex-1 rounded-t bg-primary" style={{ height: value * 8 }} />
        ))}
      </View>
      <Button
        tone="text"
        label={translator.message("mobile.prefs.visualizationValue", { count })}
        onPress={() => setCount(count === 6 ? 1 : count + 1)}
      />
    </View>
  );
}

export function BetterT3FeaturePreview(props: {
  readonly group: string;
  readonly model: BetterT3SettingsPreviewModel;
  readonly enabled: (id: string) => boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const { chatVisualMode, presentationMotion } = useAppearancePreferences();
  const { agent } = props.model;
  if (
    ["sidebar-layout", "sidebar-previews", "sidebar-sorting", "sidebar-cleanup"].includes(
      props.group,
    )
  ) {
    return <ThreadListSettingsPreview interactive />;
  }
  if (props.group === "chat-display") {
    return (
      <>
        <ChatPresentationSettingsPreview mode={chatVisualMode} motion={presentationMotion} />
        {props.enabled("chat.visualizations") ? (
          <PreviewFrame>
            <VisualizationSettingsPreview />
          </PreviewFrame>
        ) : null}
      </>
    );
  }
  if (props.group === "reasoning") {
    const placement = !agent.reasoningVisibility
      ? "none"
      : agent.reasoningWorkingOverlay
        ? "working"
        : agent.reasoningInMessage
          ? "message"
          : "chat";
    return (
      <PreviewFrame>
        {placement === "chat" ? <ExampleText message="mobile.prefs.sampleReasoning" muted /> : null}
        {placement === "working" ? (
          <View className="self-start rounded-full border border-border px-3 py-2">
            <ExampleText message="mobile.prefs.working" />
            <ExampleText message="mobile.prefs.sampleReasoning" muted />
          </View>
        ) : null}
        <View className="gap-2 rounded-xl bg-card p-3">
          {placement === "message" ? (
            <View className="border-l-2 border-primary pl-2">
              <ExampleText message="mobile.prefs.sampleReasoning" muted />
            </View>
          ) : null}
          <ExampleText message="mobile.prefs.sampleReply" />
        </View>
      </PreviewFrame>
    );
  }
  if (props.group === "composer-input") {
    return (
      <PreviewFrame>
        <ExampleText message="mobile.prefs.before" muted />
        <ExampleText message="mobile.prefs.samplePrompt" />
        {agent.promptImprovement ? (
          <>
            <Text className="text-primary">↓</Text>
            <ExampleText message="mobile.prefs.after" muted />
            <View className="rounded-xl border border-primary p-3">
              <ExampleText message="mobile.prefs.improvedPrompt" />
            </View>
          </>
        ) : null}
      </PreviewFrame>
    );
  }
  if (props.group === "agent-collaboration") {
    return (
      <PreviewFrame>
        {agent.generalSubagents ? (
          <>
            <View className="self-center rounded-xl border border-primary p-2">
              <ExampleText message="mobile.prefs.subagents" />
            </View>
            <Text className="text-center text-foreground-muted">↙ ↓ ↘</Text>
            <View className="flex-row gap-2">
              {(["inspect", "implement", "verify"] as const).map((step) => (
                <View key={step} className="flex-1 items-center rounded-lg bg-card p-2">
                  <ExampleText message={`mobile.prefs.${step}`} />
                </View>
              ))}
            </View>
          </>
        ) : (
          <ExampleText message="mobile.prefs.singleAgent" />
        )}
      </PreviewFrame>
    );
  }
  if (props.group === "context-compaction") {
    return (
      <PreviewFrame>
        <ExampleText message="mobile.prefs.contextBefore" />
        <View className="h-2 w-4/5 rounded-full bg-primary" />
        <Text className="text-primary">↓</Text>
        <ExampleText message="mobile.prefs.contextAfter" />
        <View className="h-2 w-1/4 rounded-full bg-primary" />
        <ExampleText
          muted
          message={
            props.enabled("agent.contextCompaction")
              ? "settings.betterT3.preview.examples.context.background"
              : "settings.betterT3.preview.examples.context.native"
          }
        />
      </PreviewFrame>
    );
  }
  if (props.group === "messages") {
    return (
      <PreviewFrame>
        {props.enabled("chat.messageReplies") ? (
          <View className="border-l-2 border-primary pl-2">
            <ExampleText message="mobile.prefs.replyQuote" muted />
          </View>
        ) : null}
        <ExampleText message="mobile.prefs.sampleReply" />
      </PreviewFrame>
    );
  }
  if (props.group === "git") {
    return (
      <PreviewFrame>
        <ExampleText message="mobile.prefs.gitBranch" muted />
        <ExampleText message="mobile.prefs.gitChanges" />
        <View className="rounded-lg bg-card p-2">
          <Text className="font-mono text-xs">
            src/session.ts +8 −2{"\n"}src/session.test.ts +4 −1
          </Text>
        </View>
        <ExampleText message="mobile.prefs.gitChecks" muted />
      </PreviewFrame>
    );
  }
  if (props.group === "voice-translation") {
    return (
      <PreviewFrame>
        <View className="rounded-full bg-card p-3">
          <ExampleText message="mobile.prefs.voiceSource" />
        </View>
        <Text className="text-center text-primary">↓ EN</Text>
        <ExampleText message="mobile.prefs.voiceResult" />
      </PreviewFrame>
    );
  }
  if (props.group === "project-indexing") {
    return (
      <PreviewFrame>
        <Text className="text-center text-xl">📁 → ⌕ → ✦</Text>
        <ExampleText message="mobile.prefs.indexExplanation" />
      </PreviewFrame>
    );
  }
  if (props.group === "agent-workflow") {
    return (
      <PreviewFrame>
        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card p-3">
          <View className="rounded-full bg-primary px-3 py-1">
            <Text className="text-xs text-primary-foreground">
              {translator.message(agent.planMode ? "mobile.prefs.plan" : "mobile.prefs.build")}
            </Text>
          </View>
          <Text className="flex-1 text-sm text-foreground-muted">
            {translator.message("mobile.prefs.composerSample")}
          </Text>
        </View>
        <ExampleText
          message={
            agent.planMode ? "mobile.prefs.planDescription" : "mobile.prefs.buildDescription"
          }
          muted
        />
      </PreviewFrame>
    );
  }
  return null;
}
