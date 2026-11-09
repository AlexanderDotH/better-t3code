import { BranchNamingMode, type ServerSettingsPatch } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../../components/ui/ListChoiceRow";
import { SettingsSection } from "./SettingsSection";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { currentInterfaceTranslator } from "../../../localization/currentInterfaceTranslator";

const MODES = {
  static: {
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.staticPrefix");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.addYourPrefixToTheGeneratedBranch");
    },
  },
  semantic: {
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.semanticPrefix");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.letTheModelChooseFeatFixRefactor");
    },
  },
  custom: {
    get label() {
      return currentInterfaceTranslator().message("settings.sourceControlWriting.custom");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.generateTheCompleteNameWithNoAdded");
    },
  },
} satisfies Record<BranchNamingMode, { label: string; description: string }>;

export function BranchNamingSettings(props: {
  mode: BranchNamingMode | null;
  prefix: string | null;
  instructions: string | null;
  /** Per setting, since a policy can lock one and leave the others to the user. */
  disabled: Readonly<Record<"mode" | "prefix" | "instructions", boolean>>;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  // Save on exit too: Android Back hides the keyboard without ending editing.
  type Field = "branchNamePrefix" | "branchNameInstructions";
  const drafts = useRef<Partial<Record<Field, { text: string; over: string | null }>>>({});
  const savedValue = (field: Field) =>
    field === "branchNamePrefix" ? props.prefix : props.instructions;
  const edit = (field: Field, text: string) => {
    drafts.current[field] = { text, over: savedValue(field) };
  };
  // Drop a draft typed over an older saved value: the updated value has already remounted its input.
  const take = (field: Field): ServerSettingsPatch => {
    const draft = drafts.current[field];
    delete drafts.current[field];
    const saved = savedValue(field);
    // Save even while disabled; the route queues behind pending writes and checks access.
    if (draft === undefined || draft.over !== saved) return {};
    const value = draft.text.trim();
    return saved === null || value !== saved ? { [field]: value } : {};
  };
  const send = (patch: ServerSettingsPatch) => {
    if (Object.keys(patch).length > 0) props.onChange(patch);
  };
  // One patch, because the screen drops writes while another is in flight.
  const saveDrafts = useEffectEvent(() =>
    send({ ...take("branchNamePrefix"), ...take("branchNameInstructions") }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves unsent branch naming drafts to server settings when the section unmounts
  useEffect(() => () => saveDrafts(), []);
  return (
    <SettingsSection
      title={translator.message("mobile.ui.worktreeBranchNaming")}
      trailing={
        props.mode === null ? (
          <Text className="text-xs text-foreground-muted">
            {translator.message("git.operation.mixed")}
          </Text>
        ) : null
      }
    >
      {BranchNamingMode.literals.map((mode, index) => (
        <SettingsChoiceRow
          key={mode}
          label={MODES[mode].label}
          description={MODES[mode].description}
          selected={props.mode === mode}
          separated={index > 0}
          disabled={props.disabled.mode}
          onPress={() => props.onChange({ branchNamingMode: mode })}
        />
      ))}
      {props.mode === "static" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            {translator.message("mobile.ui.useT3OrT3ForT3Add")}
          </Text>
          <AppTextInput
            key={props.prefix}
            accessibilityLabel={translator.message("mobile.ui.branchPrefix")}
            onChangeText={(text) => edit("branchNamePrefix", text)}
            defaultValue={props.prefix ?? ""}
            placeholder={
              props.prefix === null
                ? translator.message("git.operation.mixed")
                : translator.message("mobile.ui.noPrefix")
            }
            editable={!props.disabled.prefix}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={() => send(take("branchNamePrefix"))}
          />
        </View>
      ) : null}
      {props.mode === "custom" ? (
        <View className="gap-2 px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            {translator.message("mobile.ui.appendInstructionsToTheNamingPrompt")}
          </Text>
          <AppTextInput
            key={props.instructions}
            accessibilityLabel={translator.message("mobile.ui.branchNamingInstructions")}
            onChangeText={(text) => edit("branchNameInstructions", text)}
            defaultValue={props.instructions ?? ""}
            placeholder={
              props.instructions === null
                ? translator.message("mobile.ui.mixedEnterInstructionsForAllSelectedTargets")
                : translator.message("mobile.ui.useJuliusFollowedByTheIssueId")
            }
            editable={!props.disabled.instructions}
            multiline
            autoCapitalize="sentences"
            className="min-h-24 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={() => send(take("branchNameInstructions"))}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
