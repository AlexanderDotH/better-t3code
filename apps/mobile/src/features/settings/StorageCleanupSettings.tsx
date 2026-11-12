import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { View } from "react-native";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import {
  WorktreeKeepWhen,
  type ServerSettings,
  type ServerSettingsPatch,
  type WorktreeCleanupRules,
} from "@t3tools/contracts";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { ProjectSettingsSelect } from "./ProjectSettingsFields";
import { ProjectSettingsNumberRow } from "./ProjectSettingsNumberRow";
import { buildWorktreeCleanupPatch } from "./server-controls-settings";
import type { ScopedMobileSettingsTarget } from "./settings-scoped-server";

export function WorktreeCleanupSettings(props: {
  readonly targets: readonly ScopedMobileSettingsTarget[];
  readonly projectSelected: boolean;
  readonly disabledFor: (key: string) => boolean;
  readonly writeEach: (patch: (settings: ServerSettings) => ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const first = props.targets[0];
  if (!first) return null;
  const supported = props.targets.every(
    (target) =>
      target.environment.serverConfig.environment.capabilities.storageCleanup === true &&
      (!props.projectSelected ||
        target.environment.serverConfig.environment.capabilities.projectWorktreeCleanup === true),
  );
  if (!supported) return null;
  const modeFor = (target: ScopedMobileSettingsTarget) =>
    props.projectSelected && target.sources.worktreeCleanup !== "project"
      ? "inherit"
      : (target.settings.worktreeCleanup?.mode ?? "inherit");
  const mode = modeFor(first);
  const mixedMode = props.targets.some((target) => modeFor(target) !== mode);
  const rules = resolveWorktreeCleanup(first.settings, null);
  const mixed = (key: keyof WorktreeCleanupRules) =>
    props.targets.some(
      (target) => resolveWorktreeCleanup(target.settings, null)[key] !== rules[key],
    );
  const disabledFor = (key: keyof WorktreeCleanupRules) =>
    props.disabledFor("worktreeCleanup") ||
    (!props.projectSelected && props.disabledFor(`storageCleanup.${key}`));
  const update = (patch: Partial<WorktreeCleanupRules>) =>
    props.writeEach((settings) =>
      buildWorktreeCleanupPatch(settings, props.projectSelected, patch),
    );
  return (
    <SettingsSection title={translator.message("mobile.projects.cleanup.title")}>
      <ProjectSettingsSelect
        label={translator.message("mobile.projects.cleanup.mode")}
        value={mixedMode ? null : mode}
        options={(["inherit", "off", "custom"] as const).map((value) => ({
          value,
          label: translator.message(`mobile.projects.cleanup.${value}`),
        }))}
        disabled={props.disabledFor("worktreeCleanup")}
        onChange={(value) =>
          props.writeEach((settings) => ({
            worktreeCleanup:
              value === "inherit"
                ? null
                : value === "off"
                  ? { mode: "off" }
                  : { mode: "custom", rules: resolveWorktreeCleanup(settings, null) },
          }))
        }
      />
      {(!props.projectSelected || (mode === "custom" && !mixedMode)) && mode !== "off" ? (
        <>
          {(["worktreeOnDelete", "worktreeOnMerge", "worktreeUnchanged"] as const).map((key) => (
            <SettingsSwitchRow
              key={key}
              icon="trash"
              label={translator.message(`mobile.projects.cleanup.${key}`)}
              value={mixed(key) ? null : rules[key]}
              disabled={disabledFor(key)}
              onValueChange={(value) => update({ [key]: value })}
            />
          ))}
          {(["worktreeAfterDays", "worktreeSettledAfterDays"] as const)
            .filter(
              (key) =>
                key !== "worktreeSettledAfterDays" ||
                props.targets.every(
                  (target) =>
                    target.environment.serverConfig.environment.capabilities
                      .settledWorktreeCleanup === true,
                ),
            )
            .map((key) => (
              <ProjectSettingsNumberRow
                key={key}
                label={translator.message(`mobile.projects.cleanup.${key}`)}
                value={rules[key]}
                mixed={mixed(key)}
                minimum={key === "worktreeSettledAfterDays" ? 0 : 1}
                maximum={3650}
                nullable
                disabled={disabledFor(key)}
                onCommit={(value) => update({ [key]: value })}
              />
            ))}
          <ProjectSettingsSelect
            label={translator.message("mobile.projects.cleanup.worktreeKeepWhen")}
            value={mixed("worktreeKeepWhen") ? null : rules.worktreeKeepWhen}
            options={WorktreeKeepWhen.literals.map((value) => ({
              value,
              label: translator.message(`mobile.projects.cleanup.${value}`),
            }))}
            disabled={disabledFor("worktreeKeepWhen")}
            onChange={(worktreeKeepWhen) => update({ worktreeKeepWhen })}
          />
          <AppText className="px-4 pb-4 text-sm text-foreground-muted">
            {translator.message(`mobile.projects.cleanup.keep.${rules.worktreeKeepWhen}`)}
          </AppText>
        </>
      ) : null}
    </SettingsSection>
  );
}

export function StorageRetentionSettings(props: {
  readonly targets: readonly ScopedMobileSettingsTarget[];
  readonly disabledFor: (key: string) => boolean;
  readonly write: (patch: ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const first = props.targets[0];
  if (
    !first ||
    !props.targets.every(
      (target) => target.environment.serverConfig.environment.capabilities.storageCleanup === true,
    )
  )
    return null;
  return (
    <SettingsSection title={translator.message("mobile.projects.cleanup.artifacts")}>
      {(["browserArtifactsAfterDays", "logsAfterDays"] as const).map((key) => (
        <ProjectSettingsNumberRow
          key={key}
          label={translator.message(`mobile.projects.cleanup.${key}`)}
          value={first.settings.storageCleanup[key]}
          mixed={props.targets.some(
            (target) => target.settings.storageCleanup[key] !== first.settings.storageCleanup[key],
          )}
          minimum={1}
          maximum={3650}
          nullable
          disabled={props.disabledFor(`storageCleanup.${key}`)}
          onCommit={(value) => props.write({ storageCleanup: { [key]: value } })}
        />
      ))}
      {props.targets
        .filter(
          (target) =>
            target.environment.serverConfig.environment.capabilities.storageCleanupRun === true,
        )
        .map((target) => (
          <ServerCleanupAction key={target.environment.environmentId} target={target} />
        ))}
    </SettingsSection>
  );
}

function ServerCleanupAction(props: { readonly target: ScopedMobileSettingsTarget }) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = props.target.environment.environmentId;
  const allowed = useAtomValue(serverEnvironment.runStorageCleanup.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.runStorageCleanup, {
    label: "server cleanup",
    reportFailure: true,
  });
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <View className="gap-2 p-4">
      <AppText className="text-foreground">{props.target.environment.label}</AppText>
      <Button
        label={translator.message("mobile.projects.cleanup.run")}
        disabled={!allowed || pending}
        loading={pending}
        onPress={() => {
          setPending(true);
          void run({ environmentId, input: {} })
            .then((result) => {
              if (result._tag === "Success")
                setSummary(
                  translator.message("mobile.projects.cleanup.result", result.value.counts),
                );
            })
            .finally(() => setPending(false));
        }}
      />
      {summary ? <AppText className="text-sm text-foreground-muted">{summary}</AppText> : null}
    </View>
  );
}
