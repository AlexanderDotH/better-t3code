import { deriveProjectIndexChatStatus } from "@t3tools/client-runtime/project-indexing";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { useProjectIndexActivityStore } from "../../state/projectIndexActivity";
import { selectProjectIndexActivity } from "../../lib/projectIndexActivitySelection";
import { ProjectIndexStatusChip } from "./ProjectIndexChatStatus";

export function ProjectIndexActivitySummary(props: {
  readonly current: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
  };
  readonly projectLabel: string;
}) {
  const activity = useProjectIndexActivityStore((state) =>
    selectProjectIndexActivity(
      state.activitiesByEnvironment.get(props.current.environmentId),
      props.current.projectId,
      props.current.threadId,
    ),
  );
  const status = deriveProjectIndexChatStatus(activity);
  if (activity === null || status === null) return null;

  return <ProjectIndexStatusChip projectLabel={props.projectLabel} status={status} />;
}
