import { useRoute, type RouteProp } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig, useThreadShells } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import {
  buildMobileTranscriptPortabilityOptions,
  supportsMobileTranscriptPortability,
} from "./better-t3-settings";

type TranscriptPortabilityParams = {
  SettingsBetterT3TranscriptPortability: { readonly environmentId: EnvironmentId };
};

export function SettingsBetterT3TranscriptPortabilityRouteScreen() {
  const route =
    useRoute<RouteProp<TranscriptPortabilityParams, "SettingsBetterT3TranscriptPortability">>();
  const translator = useMobileInterfaceTranslator();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const threads = useThreadShells();
  const options = useMemo(
    () => buildMobileTranscriptPortabilityOptions(threads, environmentId),
    [environmentId, threads],
  );
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const [busy, setBusy] = useState(false);
  const exportThreadTranscript = useAtomCommand(orchestrationEnvironment.exportThreadTranscript, {
    reportFailure: false,
  });
  const supported = supportsMobileTranscriptPortability(
    config?.environment.capabilities.agentWorkflowVersion,
  );
  const selectedThread = options.find((option) => option.threadId === selectedThreadId) ?? null;

  const copyTranscript = async () => {
    if (!supported || selectedThread === null || busy) return;
    setBusy(true);
    try {
      const result = await exportThreadTranscript({
        environmentId,
        input: { threadId: selectedThread.threadId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Alert.alert(
            translator.message("settings.betterT3.mobile.transcript.failedTitle"),
            translator.message("settings.betterT3.mobile.transcript.failedDescription", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return;
      }
      try {
        await Clipboard.setStringAsync(result.value.content);
      } catch {
        Alert.alert(
          translator.message("settings.betterT3.mobile.transcript.failedTitle"),
          translator.message("settings.betterT3.mobile.transcript.clipboardFailed"),
        );
        return;
      }
      Alert.alert(
        translator.message("settings.betterT3.mobile.transcript.copiedTitle"),
        translator.message("settings.betterT3.mobile.transcript.copiedDescription"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AndroidScreenScaffold title={translator.message("settings.betterT3.mobile.transcript.title")}>
      <NativeStackScreenOptions
        options={{ title: translator.message("settings.betterT3.mobile.transcript.title") }}
      />
      <ScreenScaffoldScrollView>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          {translator.message("settings.betterT3.mobile.transcript.description")}
        </Text>
        {!supported ? (
          <SettingsSection
            card
            title={translator.message("settings.betterT3.mobile.transcript.title")}
          >
            <Text className="p-4 text-sm text-foreground-muted">
              {translator.message("settings.betterT3.mobile.transcript.unsupported")}
            </Text>
          </SettingsSection>
        ) : (
          <SettingsSection
            card
            title={translator.message("settings.betterT3.mobile.transcript.selectThread")}
          >
            {options.length === 0 ? (
              <Text className="p-4 text-sm text-foreground-muted">
                {translator.message("settings.betterT3.mobile.transcript.empty")}
              </Text>
            ) : (
              options.map((option, index) => {
                const selected = option.threadId === selectedThreadId;
                return (
                  <Pressable
                    key={option.threadId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`flex-row items-center gap-3 p-4 ${index === 0 ? "" : "border-t border-border-subtle"}`}
                    onPress={() => setSelectedThreadId(option.threadId)}
                  >
                    <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={2}>
                      {option.label}
                    </Text>
                    {selected ? (
                      <SymbolView
                        name="checkmark"
                        size={17}
                        tintColorClassName="accent-icon"
                        type="monochrome"
                        weight="semibold"
                      />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </SettingsSection>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !supported || selectedThread === null || busy }}
          className="mx-2 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 disabled:opacity-40"
          disabled={!supported || selectedThread === null || busy}
          onPress={() => void copyTranscript()}
        >
          {busy ? <ActivityIndicator size="small" /> : null}
          <Text className="font-t3-semibold text-primary-foreground">
            {translator.message(
              busy
                ? "settings.betterT3.mobile.transcript.copying"
                : "settings.betterT3.mobile.transcript.copy",
            )}
          </Text>
        </Pressable>
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
