import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";

const SIGNALS = [
  { key: "otlpTracesUrl", sourceKey: "otlpTracesSource" },
  { key: "otlpMetricsUrl", sourceKey: "otlpMetricsSource" },
  { key: "otlpLogsUrl", sourceKey: "otlpLogsSource" },
] as const;
type SignalKey = (typeof SIGNALS)[number]["key"];

function isValidTelemetryUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function TelemetryExportSettings(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const running = useAtomValue(
    serverEnvironment.configValueAtom(props.environmentId),
  )?.observability;
  const allowed = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(props.environmentId),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [draft, setDraft] = useState<Partial<Record<SignalKey, string>>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valid = Object.values(draft).every(isValidTelemetryUrl);
  const save = async () => {
    if (pending || !valid) return;
    setPending(true);
    const result = await update({
      environmentId: props.environmentId,
      input: {
        patch: {
          observability: Object.fromEntries(
            Object.entries(draft).map(([key, value]) => [key, value.trim()]),
          ),
        },
      },
    }).finally(() => setPending(false));
    setMessage(
      translator.message(
        result._tag === "Success" ? "mobile.insights.otlp.saved" : "mobile.insights.saveFailed",
      ),
    );
    if (result._tag === "Success") setDraft({});
  };
  return (
    <SettingsSection card title={translator.message("mobile.insights.otlp.title")}>
      <View className="gap-4 p-4">
        <Text className="text-sm text-foreground-muted">
          {translator.message("mobile.insights.otlp.description")}
        </Text>
        {SIGNALS.map(({ key, sourceKey }) => {
          const source = running?.[sourceKey];
          const overridden = source === "environment" || source === "bootstrap";
          return (
            <View key={key} className="gap-1">
              <Text className="text-sm text-foreground">
                {translator.message(`mobile.insights.otlp.${key}`)}
              </Text>
              <TextInput
                accessibilityLabel={translator.message(`mobile.insights.otlp.${key}`)}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                value={draft[key] ?? settings?.observability[key] ?? ""}
                editable={allowed && !pending && settings !== null}
                onChangeText={(value) => {
                  setDraft((previous) => {
                    const next = { ...previous, [key]: value };
                    if (value.trim() === settings?.observability[key]) delete next[key];
                    return next;
                  });
                  setMessage(null);
                }}
                className="min-h-12 rounded-xl bg-subtle px-3 text-base text-foreground"
              />
              {overridden ? (
                <Text selectable className="text-xs text-foreground-muted">
                  {translator.message("mobile.insights.otlp.override", {
                    source,
                    url: running?.[key] ?? "",
                  })}
                </Text>
              ) : null}
            </View>
          );
        })}
        {!valid ? (
          <Text className="text-xs text-danger-foreground">
            {translator.message("mobile.insights.otlp.invalid")}
          </Text>
        ) : null}
        <Button
          label={translator.message("settings.common.save")}
          disabled={!allowed || !settings || pending || !valid || Object.keys(draft).length === 0}
          loading={pending}
          onPress={() => void save()}
        />
        {message ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {message}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}
