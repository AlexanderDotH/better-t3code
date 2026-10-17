import { Editor } from "@pierre/diffs/editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Save } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { WorkspaceFileEditorSurface } from "~/components/files/WorkspaceFileEditorSurface";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type { GitCurrentFileState } from "./GitWorkbench.types";
import {
  createGitCurrentFileDraft,
  reconcileGitCurrentFileDraft,
  type GitCurrentFileDraftInput,
} from "./gitCurrentFileDraft";

interface GitCurrentFilePanelProps {
  readonly file: GitCurrentFileState;
  readonly initialDraft?: GitCurrentFileDraftInput | null | undefined;
  readonly onDraftChange?: ((draft: GitCurrentFileDraftInput) => void) | undefined;
  readonly onSave: (input: {
    readonly content: string;
    readonly expectedRevision: string;
    readonly path: string;
    readonly resolution?: "agent" | "merged" | "mine";
  }) => void;
  readonly readOnly: boolean;
}

export function GitCurrentFilePanel({
  file,
  initialDraft,
  onDraftChange,
  onSave,
  readOnly,
}: GitCurrentFilePanelProps) {
  const translate = useInterfaceTranslator().message;
  const [draft, setDraft] = useState(() => createGitCurrentFileDraft(file, initialDraft));
  const [mergedDraft, setMergedDraft] = useState(draft.content);
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);
  const changeDraft = useCallback(
    (nextFile: { readonly contents: string }) => {
      const content = nextFile.contents;
      setDraft((current) => ({ ...current, content }));
      setMergedDraft(content);
      onDraftChangeRef.current?.({ content, path: draft.path, revision: draft.revision });
    },
    [draft.path, draft.revision],
  );
  const editor = useMemo(
    // Editor stores the callback without invoking it during construction.
    // oxlint-disable-next-line react/refs
    () => new Editor<undefined>({ onChange: changeDraft }),
    [changeDraft],
  );

  const reconciledDraft = reconcileGitCurrentFileDraft(draft, file);
  if (reconciledDraft !== draft) {
    setDraft(reconciledDraft);
    if (file.saveState !== "conflict") setMergedDraft(reconciledDraft.content);
  }

  useEffect(() => {
    onDraftChange?.({ content: draft.content, path: draft.path, revision: draft.revision });
  }, [draft.content, draft.path, draft.revision, onDraftChange]);

  useEffect(() => () => editor.cleanUp(), [editor]);

  if (file.loading) {
    return (
      <p className="p-6 text-muted-foreground text-sm" role="status">
        {translate("git.changes.loadingCurrent")}
      </p>
    );
  }

  const save: GitCurrentFilePanelProps["onSave"] = (input) => {
    if (input.resolution === "agent") {
      setDraft(createGitCurrentFileDraft({ ...file, content: input.content }));
      setMergedDraft(input.content);
      onDraftChange?.({
        content: input.content,
        path: file.path,
        revision: input.expectedRevision,
      });
    }
    onSave(input);
  };

  if (file.saveState === "conflict") {
    return (
      <GitCurrentFileConflict
        file={file}
        mergedDraft={mergedDraft}
        onMergedDraftChange={(content) => {
          setMergedDraft(content);
          onDraftChange?.({ content, path: file.path, revision: file.revision });
        }}
        onSave={save}
        readOnly={readOnly}
      />
    );
  }

  const disabledReason = file.readOnlyReason ?? (readOnly ? translate("git.file.readOnly") : null);
  return (
    <section aria-labelledby="current-file-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-sm" id="current-file-heading">
            {file.path}
          </h3>
          <p className="text-muted-foreground text-xs">
            {disabledReason ?? fileSaveLabel(file.saveState, translate)}
          </p>
        </div>
        <Button
          disabled={
            Boolean(disabledReason) || draft.content === file.content || file.saveState === "saving"
          }
          onClick={() =>
            save({ content: draft.content, expectedRevision: draft.revision, path: file.path })
          }
          size="sm"
        >
          <Save aria-hidden="true" /> {translate("git.file.save")}
        </Button>
      </div>
      {file.error ? (
        <p
          className="border-b bg-destructive/8 px-3 py-2 text-destructive-foreground text-xs"
          role="alert"
        >
          {file.error}
        </p>
      ) : null}
      <WorkspaceFileEditorSurface
        ariaLabel={translate("git.file.editAria", { path: file.path })}
        contentEditable={!disabledReason}
        editor={editor}
        file={{
          cacheKey: `git-workbench:${draft.path}:${draft.revision}`,
          contents: draft.content,
          name: draft.path,
        }}
        options={{
          disableFileHeader: true,
          overflow: wordWrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(resolvedTheme),
          themeType: resolvedTheme,
        }}
      />
      {file.saveState === "buffered" ? (
        <p className="border-t bg-info/5 px-3 py-2 text-info-foreground text-xs">
          {translate("git.file.buffered")}
        </p>
      ) : null}
    </section>
  );
}

function GitCurrentFileConflict({
  file,
  mergedDraft,
  onMergedDraftChange,
  onSave,
  readOnly,
}: {
  file: GitCurrentFileState;
  mergedDraft: string;
  onMergedDraftChange: (content: string) => void;
  onSave: GitCurrentFilePanelProps["onSave"];
  readOnly: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const serverContent = file.serverContent ?? file.content;
  return (
    <section aria-labelledby="file-conflict-heading" className="flex min-h-0 flex-1 flex-col p-3">
      <div className="flex items-start gap-2 rounded-lg bg-warning/8 p-3 text-warning-foreground">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div>
          <h3 className="font-medium text-sm" id="file-conflict-heading">
            {translate("git.file.conflictTitle")}
          </h3>
          <p className="mt-1 text-xs">{translate("git.workbench.reviewVersions")}</p>
        </div>
      </div>
      <div className="mt-3 grid min-h-0 flex-1 gap-3 @2xl/git-panel:grid-cols-3">
        <ReadOnlyVersion content={file.baseContent} label={translate("git.common.base")} />
        <ReadOnlyVersion content={serverContent} label={translate("git.workbench.agentVersion")} />
        <label className="flex min-h-40 flex-col gap-1 text-xs">
          <span className="font-medium">{translate("git.workbench.mergedVersion")}</span>
          <Textarea
            className="min-h-36 flex-1 resize-none"
            variant="code"
            disabled={readOnly}
            onChange={(event) => onMergedDraftChange(event.currentTarget.value)}
            spellCheck={false}
            value={mergedDraft}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          disabled={readOnly}
          onClick={() =>
            onSave({
              content: serverContent,
              expectedRevision: file.revision,
              path: file.path,
              resolution: "agent",
            })
          }
          variant="outline"
        >
          {translate("git.file.keepAgent")}
        </Button>
        <GitWorkbenchConfirmation
          confirmLabel={translate("git.file.keepMine")}
          description={translate("git.workbench.replaceAgentVersion")}
          disabled={readOnly}
          onConfirm={() =>
            onSave({
              content: file.content,
              expectedRevision: file.revision,
              path: file.path,
              resolution: "mine",
            })
          }
          phrase="KEEP MINE"
          title={translate("git.file.replaceAgentTitle", { path: file.path })}
          triggerLabel={translate("git.file.keepMine")}
        />
        <Button
          disabled={readOnly}
          onClick={() =>
            onSave({
              content: mergedDraft,
              expectedRevision: file.revision,
              path: file.path,
              resolution: "merged",
            })
          }
        >
          {translate("git.file.saveMerged")}
        </Button>
      </div>
    </section>
  );
}

function ReadOnlyVersion({ content, label }: { content: string; label: string }) {
  return (
    <label className="flex min-h-40 flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      <Textarea
        aria-readonly="true"
        className="min-h-36 flex-1 resize-none"
        variant="code"
        readOnly
        spellCheck={false}
        value={content}
      />
    </label>
  );
}

const fileSaveLabel = (
  state: GitCurrentFileState["saveState"],
  translate: InterfaceTranslator["message"],
): string => {
  if (state === "saving") return translate("git.file.state.saving");
  if (state === "saved") return translate("git.file.state.saved");
  if (state === "buffered") return translate("git.file.state.buffered");
  return translate("git.file.state.current");
};
