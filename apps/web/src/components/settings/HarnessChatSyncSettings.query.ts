import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, HarnessChatSyncListInput } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useContext, useMemo, useState } from "react";

import { agentSettingsEnvironment } from "../../state/agentSettings";

const FIRST_PAGE = [undefined] as const;

export function useHarnessChatPages(
  environmentId: EnvironmentId,
  input: Omit<HarnessChatSyncListInput, "cursor">,
  enabled: boolean,
) {
  const registry = useContext(RegistryContext);
  const key = JSON.stringify([
    environmentId,
    input.sourceId,
    input.query,
    input.includeArchived,
    input.limit,
  ]);
  const [pagination, setPagination] = useState<{
    key: string;
    cursors: ReadonlyArray<string | undefined>;
  }>({ key, cursors: FIRST_PAGE });
  const cursors = pagination.key === key ? pagination.cursors : FIRST_PAGE;
  const pageAtoms = useMemo(
    () =>
      enabled
        ? cursors.map((cursor) =>
            agentSettingsEnvironment.harnessChatSync.listQuery({
              environmentId,
              input: { ...input, ...(cursor === undefined ? {} : { cursor }) },
            }),
          )
        : [],
    [cursors, enabled, environmentId, input],
  );
  const pagesAtom = useMemo(
    () => Atom.make((get) => pageAtoms.map((page) => get(page))),
    [pageAtoms],
  );
  const results = useAtomValue(pagesAtom);
  const pages = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const failure = results.find((result) => result._tag === "Failure");
  const error = failure?._tag === "Failure" ? Cause.squash(failure.cause) : null;
  const nextCursor = pages.at(-1)?.nextCursor;
  const isPending =
    enabled &&
    (results.length === 0 ||
      results.some((result) => AsyncResult.isInitial(result) || result.waiting));
  return {
    pages,
    error:
      error === null
        ? null
        : error instanceof Error
          ? error.message
          : "Could not load harness chats.",
    isPending,
    hasNextPage: nextCursor !== null && nextCursor !== undefined,
    loadNext: () => {
      if (
        isPending ||
        nextCursor === null ||
        nextCursor === undefined ||
        cursors.includes(nextCursor)
      )
        return;
      setPagination({ key, cursors: [...cursors, nextCursor] });
    },
    refresh: () => {
      setPagination({ key, cursors: FIRST_PAGE });
      if (pageAtoms[0]) registry.refresh(pageAtoms[0]);
      registry.refresh(
        agentSettingsEnvironment.harnessChatSync.sourcesQuery({ environmentId, input: {} }),
      );
    },
  };
}
