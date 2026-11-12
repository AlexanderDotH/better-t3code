import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ProjectReadFileResult, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useMemo, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { setReviewCommentTarget } from "../review/reviewCommentSelection";
import type { ReviewRenderableLineRow } from "../review/reviewModel";
import { WorkbenchButton } from "../threads/git/WorkbenchControls";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { markdownTasks, toggleMarkdownTask } from "./file-edit-model";
import { SourceFileSurface } from "./SourceFileSurface";
import { WorkspaceFileEditor } from "./WorkspaceFileEditor";

export function WorkspaceTextFileContent(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly threadId: ThreadId | null;
  readonly file: ProjectReadFileResult;
  readonly markdownPreview: boolean;
  readonly isMarkdown: boolean;
  readonly initialLine: number | null;
  readonly headerInsetTop?: number;
  readonly onRefresh?: () => Promise<void> | void;
}) {
  const t = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(props.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const [editor, setEditor] = useState<{
    readonly initialContents?: string;
    readonly initialFile?: ProjectReadFileResult;
  } | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [selection, setSelection] = useState<{
    readonly anchor: number;
    readonly end: number;
    readonly contents: string;
  } | null>(null);
  const lines = useMemo<ReadonlyArray<ReviewRenderableLineRow>>(
    () =>
      props.file.contents.split(/\r?\n/).map((content, index) => ({
        kind: "line",
        id: `file:${props.relativePath}:${index}`,
        change: "context",
        content,
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
        additionTokenIndex: null,
        deletionTokenIndex: null,
        comparison: null,
      })),
    [props.file.contents, props.relativePath],
  );
  const activeSelection = selection?.contents === props.file.contents ? selection : null;
  const selectedLines = activeSelection
    ? {
        start: Math.min(activeSelection.anchor, activeSelection.end),
        end: Math.max(activeSelection.anchor, activeSelection.end),
      }
    : null;
  const tasks = useMemo(
    () => (props.isMarkdown ? markdownTasks(props.file.contents) : []),
    [props.isMarkdown, props.file.contents],
  );
  const writable = canWrite && !props.file.truncated && !!props.file.revision;
  const comment = () => {
    if (!props.threadId || !selectedLines) return;
    const sectionId = `file:${props.relativePath}`;
    setReviewCommentTarget(
      {
        key: JSON.stringify([props.environmentId, props.threadId, sectionId]),
        content: props.file.contents,
      },
      {
        sectionId,
        sectionTitle: props.relativePath,
        filePath: props.relativePath,
        lines,
        startIndex: selectedLines.start,
        endIndex: selectedLines.end,
      },
    );
    navigation.navigate("ThreadReviewComment", {
      environmentId: props.environmentId,
      threadId: props.threadId,
    });
  };
  const toggleTask = async (offset: number) => {
    if (!writable || savingTask || !props.file.revision) return;
    const contents = toggleMarkdownTask(props.file.contents, offset);
    if (contents === props.file.contents) return;
    setSavingTask(true);
    const result = await writeFile({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        relativePath: props.relativePath,
        contents,
        expectedRevision: props.file.revision,
      },
    });
    setSavingTask(false);
    void props.onRefresh?.();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setShowTasks(false);
      setEditor({ initialContents: contents, initialFile: props.file });
      const failure = squashAtomCommandFailure(result);
      Alert.alert(
        t.message("mobile.git.updateFailed"),
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  };
  return (
    <View className="flex-1">
      <View className="flex-row flex-wrap gap-2 border-b border-border px-3 py-2">
        <WorkbenchButton
          label={t.message("mobile.gitParity.edit")}
          disabled={!writable}
          onPress={() => setEditor({})}
        />
        {tasks.length ? (
          <WorkbenchButton
            label={t.message("mobile.gitParity.taskLists")}
            onPress={() => setShowTasks(true)}
          />
        ) : null}
        {props.threadId && selectedLines ? (
          <WorkbenchButton label={t.message("mobile.gitParity.commentLines")} onPress={comment} />
        ) : null}
      </View>
      {props.markdownPreview ? (
        <FileMarkdownPreview {...props} markdown={props.file.contents} />
      ) : (
        <>
          {props.threadId ? (
            <AppText className="px-3 py-1 text-xs text-foreground-muted">
              {t.message("mobile.gitParity.selectLines")}
            </AppText>
          ) : null}
          <SourceFileSurface
            contents={props.file.contents}
            path={props.relativePath}
            initialLine={props.initialLine}
            headerInsetTop={props.headerInsetTop}
            selectedLines={selectedLines}
            onSelectLine={
              props.threadId
                ? (index) =>
                    setSelection(
                      activeSelection && activeSelection.anchor === activeSelection.end
                        ? {
                            anchor: activeSelection.anchor,
                            end: index,
                            contents: props.file.contents,
                          }
                        : { anchor: index, end: index, contents: props.file.contents },
                    )
                : undefined
            }
            onRefresh={props.onRefresh}
          />
        </>
      )}
      {editor ? (
        <WorkspaceFileEditor
          {...props}
          path={props.relativePath}
          file={props.file}
          initialContents={editor.initialContents}
          initialFile={editor.initialFile}
          onRefresh={() => {
            void props.onRefresh?.();
          }}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <Modal
        visible={showTasks}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTasks(false)}
      >
        <View
          className="flex-1 gap-3 bg-sheet px-4"
          style={{
            paddingTop: Platform.OS === "android" ? insets.top + 12 : 16,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <WorkbenchButton label={t.message("common.close")} onPress={() => setShowTasks(false)} />
          <ScrollView>
            {tasks.map((task) => (
              <Pressable
                key={task.offset}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: task.checked, disabled: !writable || savingTask }}
                disabled={!writable || savingTask}
                className="flex-row gap-3 border-b border-border py-4"
                onPress={() => void toggleTask(task.offset)}
              >
                <AppText className="text-base text-foreground">{task.checked ? "☑" : "☐"}</AppText>
                <AppText className="min-w-0 flex-1 text-sm text-foreground">{task.label}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
