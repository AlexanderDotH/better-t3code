import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkbenchButton } from "../threads/git/WorkbenchControls";
import { createFileEdit, reconcileFileEdit } from "./file-edit-model";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";

export function WorkspaceFileEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly file: ProjectReadFileResult;
  readonly initialContents?: string;
  readonly initialFile?: ProjectReadFileResult;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}) {
  const t = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(props.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const [edit, setEdit] = useState(() => {
    const base = props.initialFile ?? props.file;
    return { ...createFileEdit(base), draft: props.initialContents ?? base.contents };
  });
  const reconciled = reconcileFileEdit(edit, props.file);
  if (reconciled !== edit) setEdit(reconciled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeRevision = edit.conflict ? edit.remoteRevision : edit.revision;
  const close = () => {
    if (saving) return;
    if (edit.draft === edit.base) {
      props.onClose();
      return;
    }
    Alert.alert(
      t.message("mobile.gitParity.unsavedTitle"),
      t.message("mobile.gitParity.unsavedDescription"),
      [
        { text: t.message("common.cancel"), style: "cancel" },
        { text: t.message("mobile.git.discard"), style: "destructive", onPress: props.onClose },
      ],
    );
  };
  const save = async () => {
    if (!canWrite || saving || !safeRevision || props.file.truncated) return;
    setSaving(true);
    setError(null);
    const result = await writeFile({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        relativePath: props.path,
        contents: edit.draft,
        expectedRevision: safeRevision,
      },
    });
    setSaving(false);
    props.onRefresh();
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      return;
    }
    props.onSaved?.();
    props.onClose();
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View
        className="flex-1 gap-3 bg-sheet px-4"
        style={{
          paddingTop: Platform.OS === "android" ? insets.top + 12 : 16,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
      >
        <View className="flex-row items-center gap-2">
          <WorkbenchButton
            label={t.message("mobile.gitParity.closeEditor")}
            disabled={saving}
            onPress={close}
          />
          <AppText className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={2}>
            {props.path}
          </AppText>
          <WorkbenchButton
            disabled={
              !canWrite ||
              saving ||
              !safeRevision ||
              props.file.truncated ||
              (!edit.conflict && edit.draft === edit.base)
            }
            label={t.message(edit.conflict ? "mobile.gitParity.merge" : "git.file.save")}
            onPress={() => void save()}
          />
        </View>
        {!safeRevision ? (
          <AppText className="text-sm text-amber-600">
            {t.message(
              props.file.exists === false
                ? "mobile.gitParity.deletedFile"
                : "mobile.gitParity.missingRevision",
            )}
          </AppText>
        ) : null}
        {!safeRevision ? (
          <WorkbenchButton
            label={t.message("mobile.ui.copyContents")}
            onPress={() => {
              void copyTextWithHaptic(edit.draft);
            }}
          />
        ) : null}
        {error ? <AppText className="text-sm text-red-500">{error}</AppText> : null}
        {edit.conflict ? (
          <View className="gap-2">
            <AppText className="text-sm text-amber-600">
              {t.message("mobile.gitParity.concurrent")}
            </AppText>
            <View className="flex-row gap-2">
              {[
                { label: t.message("git.common.base"), contents: edit.base },
                { label: t.message("mobile.gitParity.currentFile"), contents: edit.remote },
              ].map((version) => (
                <View key={version.label} className="min-w-0 flex-1 gap-1">
                  <AppText className="text-xs text-foreground-muted">{version.label}</AppText>
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 180 }}>
                    <AppText selectable className="font-mono text-xs text-foreground">
                      {version.contents}
                    </AppText>
                  </ScrollView>
                </View>
              ))}
            </View>
            <View className="flex-row flex-wrap gap-2">
              <WorkbenchButton
                label={t.message("mobile.gitParity.reload")}
                disabled={saving}
                onPress={() => setEdit(createFileEdit(props.file))}
              />
              <WorkbenchButton
                label={t.message("mobile.gitParity.keepMine")}
                disabled={!canWrite || saving || !safeRevision}
                onPress={() =>
                  Alert.alert(t.message("mobile.gitParity.keepMine"), props.path, [
                    { text: t.message("common.cancel"), style: "cancel" },
                    {
                      text: t.message("git.file.save"),
                      style: "destructive",
                      onPress: () => void save(),
                    },
                  ])
                }
              />
            </View>
          </View>
        ) : null}
        <AppTextInput
          accessibilityLabel={t.message("mobile.gitParity.yourEdits")}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
          editable={canWrite && !saving && !props.file.truncated}
          value={edit.draft}
          onChangeText={(draft) => setEdit({ ...edit, draft })}
          className="flex-1 rounded-xl border border-border bg-screen p-3 font-mono text-sm text-foreground"
        />
      </View>
    </Modal>
  );
}
