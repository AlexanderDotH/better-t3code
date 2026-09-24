import { deriveProjectIndexChatStatus } from "@t3tools/client-runtime/project-indexing";
import { WaypointsIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { selectProjectGroupIndexingActivity } from "../../lib/projectIndexActivitySelection";
import { useProjectIndexActivityStore } from "../../state/projectIndexActivity";

export function ProjectIndexSidebarIndicator({
  project,
}: {
  readonly project: Pick<
    SidebarProjectSnapshot,
    "displayName" | "environmentPresence" | "memberProjectRefs"
  >;
}) {
  const { message } = useInterfaceTranslator();
  const entry = useProjectIndexActivityStore((state) =>
    selectProjectGroupIndexingActivity(state.activeByProject, project.memberProjectRefs),
  );
  const status = deriveProjectIndexChatStatus(entry?.activity ?? null);
  if (status === null) return null;

  const label = `${project.displayName} · ${message("projectIndexing.title")}: ${message(`projectIndexing.state.${status.stage}`)}`;
  const position =
    project.environmentPresence === "remote-only"
      ? "right-7 max-sm:right-20"
      : "right-1.5 max-sm:right-14";

  return (
    <span
      role="img"
      aria-label={label}
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 inline-flex size-5 items-center justify-center rounded-md text-primary transition-opacity duration-150 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100 ${position}`}
    >
      <WaypointsIcon aria-hidden className="size-3.5 motion-safe:animate-status-pulse" />
    </span>
  );
}
