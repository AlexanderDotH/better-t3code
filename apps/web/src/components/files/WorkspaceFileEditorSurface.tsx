import type { FileContents, FileOptions, LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { Editor } from "@pierre/diffs/editor";
import { EditProvider, File, Virtualizer } from "@pierre/diffs/react";
import type { ReactNode, RefObject } from "react";

interface WorkspaceFileEditorSurfaceProps<LAnnotation> {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly contentEditable: boolean;
  readonly editor: Editor<LAnnotation>;
  readonly file: FileContents;
  readonly lineAnnotations?: LineAnnotation<LAnnotation>[];
  readonly options?: FileOptions<LAnnotation>;
  readonly renderAnnotation?: (annotation: LineAnnotation<LAnnotation>) => ReactNode;
  readonly selectedLines?: SelectedLineRange | null;
  readonly surfaceRef?: RefObject<HTMLDivElement | null>;
}

/** Shared code-editor shell for current workspace files. Loading and persistence stay with the owner. */
export function WorkspaceFileEditorSurface<LAnnotation = undefined>({
  ariaLabel,
  className = "min-h-full",
  contentEditable,
  editor,
  file,
  lineAnnotations,
  options,
  renderAnnotation,
  selectedLines,
  surfaceRef,
}: WorkspaceFileEditorSurfaceProps<LAnnotation>) {
  return (
    <EditProvider editor={editor}>
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
            contentEditable={contentEditable}
          />
        </Virtualizer>
      </div>
    </EditProvider>
  );
}
