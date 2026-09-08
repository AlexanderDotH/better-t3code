import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentSubagentStateAtoms,
  EMPTY_ENVIRONMENT_SUBAGENT_STATE,
  type EnvironmentSubagentState,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

export const threadEnvironment = createThreadEnvironmentAtoms(connectionAtomRuntime);
const environmentSubagents = createEnvironmentSubagentStateAtoms(connectionAtomRuntime);
const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("web-environment-thread:empty"),
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

const EMPTY_SUBAGENT_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_SUBAGENT_STATE));

export function useEnvironmentSubagent(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
  subagentId: SubagentId | null,
): EnvironmentSubagentState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null && subagentId !== null
      ? environmentSubagents.stateAtom(environmentId, threadId, subagentId)
      : EMPTY_SUBAGENT_STATE_ATOM,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_SUBAGENT_STATE);
}
