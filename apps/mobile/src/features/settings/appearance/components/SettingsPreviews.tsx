import { useAtomValue } from "@effect/atom-react";
import type { ChatVisualMode } from "@t3tools/contracts";
import { resolveChatPresentation } from "@t3tools/client-runtime/chat-presentation";
import { resolveBetterT3ThreadListPreview } from "@t3tools/client-runtime/better-t3-settings-preview";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { AppText as Text } from "../../../../components/ui/AppText";
import { Button } from "../../../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom } from "../../../../state/preferences";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  resolveMobileThreadListLayout,
  type MobileThreadListLayout,
} from "../threadListAppearance";

const THREADS = [
  { id: "sign-in", title: "mobile.prefs.sampleThread", created: 1, updated: 6, settled: false },
  {
    id: "shortcuts",
    title: "mobile.prefs.sampleThreadNew",
    created: 5,
    updated: 5,
    settled: false,
  },
  { id: "docs", title: "mobile.prefs.sampleThreadOld", created: 4, updated: 4, settled: false },
  { id: "sign-in-2", title: "mobile.prefs.sampleThread", created: 3, updated: 3, settled: false },
  {
    id: "shortcuts-2",
    title: "mobile.prefs.sampleThreadNew",
    created: 2,
    updated: 2,
    settled: false,
  },
  { id: "docs-2", title: "mobile.prefs.sampleThreadOld", created: 0, updated: 0, settled: true },
] as const;

export function ThreadListSettingsPreview(props: {
  readonly layout?: MobileThreadListLayout;
  readonly interactive?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const { appearance } = useAppearancePreferences();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const stored = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const layout =
    props.layout ??
    resolveMobileThreadListLayout(stored?.legacyThreadListEnabled, stored?.boringThreadListEnabled);
  const [settled, setSettled] = useState(false);
  const list = resolveBetterT3ThreadListPreview(THREADS, {
    sort: stored?.sidebarThreadSortOrder ?? "updated_at",
    count: appearance.projectThreadPreviewCount,
    settleId: settled ? "sign-in" : null,
  });
  return (
    <View className="gap-2 border-t border-border-subtle p-4">
      <Text className="text-xs text-foreground-muted">
        {translator.message("mobile.prefs.preview")}
      </Text>
      <View className="gap-1 rounded-xl bg-screen p-3">
        <Text className="font-t3-medium text-sm">better-t3code</Text>
        {list.visible.map((item) => (
          <View
            key={item.id}
            className={
              layout === "current"
                ? "gap-1 rounded-xl border border-border bg-card p-3"
                : layout === "classic"
                  ? "flex-row items-center gap-2 py-2"
                  : "flex-row items-center gap-2 py-1"
            }
          >
            {layout !== "current" ? (
              <Text className="text-primary">{layout === "boring" ? "›" : "•"}</Text>
            ) : null}
            <Text
              className={layout === "boring" ? "flex-1 text-xs" : "flex-1 text-sm"}
              numberOfLines={1}
            >
              {translator.message(item.title)}
            </Text>
            {item.id === "sign-in" ? (
              <Text className="text-xs text-foreground-muted">
                {translator.message("mobile.prefs.working")}
              </Text>
            ) : null}
          </View>
        ))}
        {list.hiddenCount > 0 ? (
          <Text className="text-xs text-foreground-muted">+{list.hiddenCount}</Text>
        ) : null}
        <Text className="pt-2 text-xs text-foreground-muted">
          {translator.message("mobile.prefs.settled")} · {list.settled.length}
        </Text>
        {list.settled.map((item) => (
          <Text key={item.id} className="text-xs text-foreground-muted" numberOfLines={1}>
            {translator.message(item.title)}
          </Text>
        ))}
      </View>
      {props.interactive ? (
        <Button
          tone="text"
          label={translator.message(
            settled ? "mobile.prefs.restorePreview" : "mobile.prefs.settlePreview",
          )}
          onPress={() => setSettled(!settled)}
        />
      ) : null}
    </View>
  );
}

export function ChatPresentationSettingsPreview(props: {
  readonly mode: ChatVisualMode;
  readonly motion: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const reducedMotion = useReducedMotion();
  const [replay, setReplay] = useState(0);
  const presentation = resolveChatPresentation({
    mode: props.mode,
    presentationMotion: props.motion,
    characterStreamingMotion: false,
    reducedMotion,
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={translator.message("mobile.prefs.replay")}
      onPress={() => setReplay(replay + 1)}
      className="gap-2 border-t border-border-subtle p-4"
    >
      <Text className="text-xs text-foreground-muted">
        {translator.message("mobile.prefs.preview")} · {translator.message("mobile.prefs.replay")}
      </Text>
      <Animated.View
        key={`${props.mode}:${replay}`}
        entering={
          presentation.presentationMotion
            ? FadeIn.duration(240).reduceMotion(ReduceMotion.System)
            : undefined
        }
        className="gap-3 rounded-xl bg-screen p-3"
      >
        <View
          className={
            props.mode === "current"
              ? "self-end rounded-2xl bg-user-bubble p-3"
              : "border-l-2 border-primary pl-3"
          }
        >
          <Text
            className={props.mode === "current" ? "text-sm text-user-bubble-foreground" : "text-sm"}
          >
            {translator.message("mobile.prefs.samplePrompt")}
          </Text>
        </View>
        <View
          className={
            props.mode === "better-t3" ? "rounded-xl border border-border bg-card p-3" : "py-2"
          }
        >
          <Text className="text-sm">{translator.message("mobile.prefs.sampleReply")}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
