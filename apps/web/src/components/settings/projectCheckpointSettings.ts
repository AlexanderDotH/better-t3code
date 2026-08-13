import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

export type ProjectCheckpointSettingState = "enabled" | "disabled" | "mixed";

export interface ProjectCheckpointSetting {
  readonly state: ProjectCheckpointSettingState;
  readonly effectiveEnabled: boolean;
}

export function resolveProjectCheckpointSetting(
  projects: ReadonlyArray<{ readonly checkpointsEnabled: boolean }>,
): ProjectCheckpointSetting {
  if (projects.length === 0) {
    return { state: "disabled", effectiveEnabled: false };
  }
  const enabledCount = projects.filter((project) => project.checkpointsEnabled).length;
  if (enabledCount === projects.length) {
    return { state: "enabled", effectiveEnabled: true };
  }
  if (enabledCount === 0) {
    return { state: "disabled", effectiveEnabled: false };
  }
  return { state: "mixed", effectiveEnabled: false };
}

export interface ProjectGroupUpdateFailure<Member, E> {
  readonly member: Member;
  readonly result: Extract<AtomCommandResult<unknown, E>, { readonly _tag: "Failure" }>;
}

export async function updateProjectGroupMembers<Member, Value, E>(
  members: ReadonlyArray<Member>,
  update: (member: Member) => Promise<AtomCommandResult<Value, E>>,
): Promise<{ readonly failures: ReadonlyArray<ProjectGroupUpdateFailure<Member, E>> }> {
  const failures: Array<ProjectGroupUpdateFailure<Member, E>> = [];
  for (const member of members) {
    const result = await update(member);
    if (result._tag === "Failure") {
      failures.push({ member, result });
    }
  }
  return { failures };
}

export async function runExclusiveProjectGroupUpdate<Value>(
  fence: { current: boolean },
  update: () => Promise<Value>,
): Promise<Value | undefined> {
  if (fence.current) return undefined;
  fence.current = true;
  try {
    return await update();
  } finally {
    fence.current = false;
  }
}
