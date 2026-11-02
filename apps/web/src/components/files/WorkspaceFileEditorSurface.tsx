import type { FileContents, FileOptions, LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { Editor, type EditorFactory, type EditorChangeEvent } from "@pierre/diffs/edit";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import { type ReactNode, type RefObject } from "react";
interface WorkspaceFileEditorSurfaceProps<LAnnotation> {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly contentEditable: boolean;
  readonly onEditChange: (event: EditorChangeEvent<"file", LAnnotation, undefined>) => void;
  readonly file: FileContents;
  readonly lineAnnotations?: LineAnnotation<LAnnotation>[];
  readonly options?: FileOptions<LAnnotation, undefined>;
  readonly renderAnnotation?: (annotation: LineAnnotation<LAnnotation>) => ReactNode;
  readonly selectedLines?: SelectedLineRange | null;
  readonly surfaceRef?: RefObject<HTMLDivElement | null>;
}
/** Shared code-editor shell for current workspace files. Loading and persistence stay with the owner. */
export function WorkspaceFileEditorSurface<LAnnotation = undefined>({
  ariaLabel,
  className = "min-h-full",
  contentEditable,
  onEditChange,
  file,
  lineAnnotations,
  options,
  renderAnnotation,
  selectedLines,
  surfaceRef,
}: WorkspaceFileEditorSurfaceProps<LAnnotation>) {
  const createEditor = (() => createFileEditor<LAnnotation>())();
  return (
    <EditProvider createEditor={createEditor}>
      <div ref={surfaceRef} aria-label={ariaLabel} className="flex min-h-0 flex-1" role="region">
        <Virtualizer
          className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <File<LAnnotation>
            file={file}
            {...(options ? { options } : {})}
            {...(lineAnnotations ? { lineAnnotations } : {})}
            {...(selectedLines !== undefined ? { selectedLines } : {})}
            {...(renderAnnotation ? { renderAnnotation } : {})}
            className={className}
            edit={contentEditable}
            onEditChange={onEditChange}
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}
function createFileEditor<LAnnotation>(): EditorFactory<LAnnotation, undefined> {
  return (editorType, options, editStateKey) => new Editor(editorType, options, editStateKey);
}
