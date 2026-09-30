import type { ProjectSourceRangeV1 } from "@t3tools/contracts";
import { FileCodeIcon } from "lucide-react";

import { InlineButton } from "../ui/button";

export interface ProjectIndexSourceLocation {
  readonly path: string;
  readonly range: ProjectSourceRangeV1;
}

export function ProjectIndexSourceLink({
  path,
  range,
  onOpenSource,
}: ProjectIndexSourceLocation & {
  readonly onOpenSource: (path: string, line: number | null) => void;
}) {
  const location = `${path}:${range.startLine}:${range.startColumn}`;

  return (
    <span className="inline-flex min-h-6 max-w-full items-center text-xs">
      <InlineButton
        className="min-w-0 max-w-full"
        aria-label={location}
        onClick={() => onOpenSource(path, range.startLine)}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-left font-mono whitespace-normal">
          <FileCodeIcon aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 break-all">{location}</span>
        </span>
      </InlineButton>
    </span>
  );
}
