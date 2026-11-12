import { useState } from "react";
import { View } from "react-native";
import {
  DEFAULT_SNOOZE_PRESETS,
  MAX_SNOOZE_PRESETS,
  SnoozePresetDay,
  type SnoozePresetSetting,
} from "@t3tools/contracts/settings";
import { resolveSnoozePresets, sortSnoozeRows } from "@t3tools/client-runtime/state/thread-settled";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ProjectSettingsField, ProjectSettingsSelect } from "./ProjectSettingsFields";
import { SettingsSection } from "./components/SettingsSection";
import { parseSnoozePresets, snoozePresetDraft } from "./snooze-presets-settings";

export function SnoozePresetsSettings(props: {
  readonly presets: readonly SnoozePresetSetting[];
  readonly disabled: boolean;
  readonly onSave: (presets: readonly SnoozePresetSetting[]) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [rows, setRows] = useState(() => props.presets.map(snoozePresetDraft));
  const [nextKey, setNextKey] = useState(rows.length);
  const [now, setNow] = useState(() => new Date());
  const parsed = parseSnoozePresets(rows);
  const menu = parsed === null ? [] : resolveSnoozePresets(now, { presets: parsed });
  const whenOptions = ["after" as const, ...SnoozePresetDay.literals].map((value) => ({
    value,
    label: translator.message(`mobile.projects.snooze.${value}`),
  }));
  const move = (index: number, offset: number) =>
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (row) next.splice(index + offset, 0, row);
      return next;
    });
  return (
    <SettingsSection
      title={translator.message("mobile.projects.snooze.title")}
      footer={translator.message("mobile.projects.snooze.description")}
    >
      {rows.map((row, index) => (
        <View key={row.key} className="border-b border-border-subtle pb-3">
          <ProjectSettingsSelect
            label={translator.message("mobile.projects.snooze.when")}
            value={row.when}
            options={whenOptions}
            disabled={props.disabled}
            onChange={(when) =>
              setRows((current) =>
                current.map((item) => (item.key === row.key ? { ...item, when } : item)),
              )
            }
          />
          <ProjectSettingsField
            label={translator.message(
              row.when === "after"
                ? "mobile.projects.snooze.minutes"
                : "mobile.projects.snooze.time",
            )}
            value={row.when === "after" ? row.minutes : row.time}
            numeric={row.when === "after"}
            disabled={props.disabled}
            onChange={(value) => {
              const field = row.when === "after" ? "minutes" : "time";
              setRows((current) =>
                current.map((item) => (item.key === row.key ? { ...item, [field]: value } : item)),
              );
            }}
          />
          <View className="flex-row flex-wrap gap-2 px-4">
            <Button
              label={translator.message("mobile.projects.moveUp")}
              disabled={props.disabled || index === 0}
              tone="text"
              onPress={() => move(index, -1)}
            />
            <Button
              label={translator.message("mobile.projects.moveDown")}
              disabled={props.disabled || index === rows.length - 1}
              tone="text"
              onPress={() => move(index, 1)}
            />
            <Button
              label={translator.message("mobile.projects.remove")}
              disabled={props.disabled}
              tone="text"
              onPress={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            />
          </View>
        </View>
      ))}
      <View className="gap-3 p-4">
        <AppText className="font-t3-medium text-foreground">
          {translator.message("mobile.projects.snooze.preview")}
        </AppText>
        {parsed === null ? (
          <AppText className="text-danger">
            {translator.message("mobile.projects.snooze.invalid")}
          </AppText>
        ) : menu.length === 0 ? (
          <AppText className="text-foreground-muted">
            {translator.message("mobile.projects.snooze.customOnly")}
          </AppText>
        ) : (
          menu.map((preset) => (
            <AppText key={preset.id} className="text-foreground">
              {preset.label} · {preset.whenLabel}
            </AppText>
          ))
        )}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={translator.message("mobile.projects.snooze.add")}
            disabled={props.disabled || rows.length >= MAX_SNOOZE_PRESETS}
            onPress={() => {
              setRows((current) => [
                ...current,
                snoozePresetDraft({ kind: "after", minutes: 60 }, nextKey),
              ]);
              setNextKey(nextKey + 1);
            }}
          />
          <Button
            label={translator.message("mobile.projects.snooze.sort")}
            disabled={props.disabled || parsed === null}
            onPress={() => {
              if (!parsed) return;
              const refreshed = new Date();
              const sorted = sortSnoozeRows(parsed, rows, refreshed);
              setRows([...sorted.keys]);
              setNow(refreshed);
            }}
          />
          <Button
            label={translator.message("mobile.projects.reset")}
            disabled={props.disabled}
            tone="text"
            onPress={() => {
              setRows(
                DEFAULT_SNOOZE_PRESETS.map((preset, index) =>
                  snoozePresetDraft(preset, nextKey + index),
                ),
              );
              setNextKey(nextKey + DEFAULT_SNOOZE_PRESETS.length);
            }}
          />
          <Button
            label={translator.message("mobile.projects.save")}
            disabled={props.disabled || parsed === null}
            tone="primary"
            onPress={() => {
              if (parsed) props.onSave(parsed);
            }}
          />
        </View>
      </View>
    </SettingsSection>
  );
}
