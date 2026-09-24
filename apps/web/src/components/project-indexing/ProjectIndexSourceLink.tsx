import type { ProjectSourceRangeV1 } from "@t3tools/contracts";
import { FileCodeIcon } from "lucide-react";

import { Button } from "../ui/button";

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
    <Button
      size="xs"
      variant="link"
      className="h-auto min-h-6 max-w-full justify-start gap-1.5 px-0 text-left font-mono text-xs whitespace-normal"
      aria-label={location}
      onClick={() => onOpenSource(path, range.startLine)}
    >
      <FileCodeIcon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 break-all">{location}</span>
    </Button>
  );
}
