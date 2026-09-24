import { applyProjectIndexActivityEvent } from "@t3tools/client-runtime/project-indexing";
import type {
  EnvironmentId,
  ProjectIndexActivityEvent,
  ProjectIndexActivityV1,
} from "@t3tools/contracts";
import { create } from "zustand";

import {
  selectActiveProjectIndexActivities,
  type ScopedProjectIndexActivity,
} from "../lib/projectIndexActivitySelection";

interface ProjectIndexActivityState {
  readonly activitiesByEnvironment: ReadonlyMap<
    EnvironmentId,
    ReadonlyMap<string, ProjectIndexActivityV1>
  >;
  readonly activeByProject: ReadonlyMap<string, ScopedProjectIndexActivity>;
  readonly applyEvent: (environmentId: EnvironmentId, event: ProjectIndexActivityEvent) => void;
  readonly clearEnvironment: (environmentId: EnvironmentId) => void;
}

export const useProjectIndexActivityStore = create<ProjectIndexActivityState>()((set) => ({
  activitiesByEnvironment: new Map(),
  activeByProject: new Map(),
  applyEvent: (environmentId, event) =>
    set((current) => {
      const previous = current.activitiesByEnvironment.get(environmentId) ?? new Map();
      const next = applyProjectIndexActivityEvent(previous, event);
      if (next === previous) return current;

      const activitiesByEnvironment = new Map(current.activitiesByEnvironment);
      activitiesByEnvironment.set(environmentId, next);
      return {
        activitiesByEnvironment,
        activeByProject: selectActiveProjectIndexActivities(
          activitiesByEnvironment,
          current.activeByProject,
        ),
      };
    }),
  clearEnvironment: (environmentId) =>
    set((current) => {
      if (!current.activitiesByEnvironment.has(environmentId)) return current;
      const activitiesByEnvironment = new Map(current.activitiesByEnvironment);
      activitiesByEnvironment.delete(environmentId);
      return {
        activitiesByEnvironment,
        activeByProject: selectActiveProjectIndexActivities(
          activitiesByEnvironment,
          current.activeByProject,
        ),
      };
    }),
}));
