import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useProjects } from "../../state/entities";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { pullRequestReviewKey } from "./pullRequestReviewDrafts";
import type { PullRequestParams } from "./usePullRequestDiff";

const actingEnvironmentFamily = Atom.family((_key: string) =>
  Atom.make<EnvironmentId | null>(null).pipe(Atom.keepAlive),
);

export function usePullRequestActingEnvironment(params: PullRequestParams) {
  const projects = useProjects();
  const environments = useWorkspaceEnvironments();
  const atom = actingEnvironmentFamily(pullRequestReviewKey(params));
  const selected = useAtomValue(atom);
  const select = useAtomSet(atom);
  const own = projects.find(
    (project) => project.environmentId === params.environmentId && project.id === params.projectId,
  );
  const host = params.host ?? own?.repositoryIdentity?.canonicalKey.split("/")[0];
  const identity = host
    ? `${host}/${params.repository}`.toLowerCase()
    : own?.repositoryIdentity?.canonicalKey.toLowerCase();
  const choices = environments.flatMap((environment) => {
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === environment.environmentId &&
        (candidate === own ||
          (identity !== undefined &&
            candidate.repositoryIdentity?.canonicalKey.toLowerCase() === identity)),
    );
    return project && environment.isEnabled
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.environmentLabel,
            project,
            connected: environment.connectionState === "connected",
          },
        ]
      : [];
  });
  const acting =
    selected === null
      ? choices.find((choice) => choice.environmentId === params.environmentId)
      : choices.find((choice) => choice.environmentId === selected);
  return {
    choices,
    select,
    acting,
    available: selected === null || acting?.connected === true,
    params: acting
      ? {
          ...params,
          environmentId: String(acting.environmentId),
          projectId: String(acting.project.id),
        }
      : params,
  };
}
