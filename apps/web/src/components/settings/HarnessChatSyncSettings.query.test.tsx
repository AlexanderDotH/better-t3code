import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  HarnessChatSyncSourceId,
  type HarnessChatSyncListInput,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useHarnessChatPages } from "./HarnessChatSyncSettings.query";

vi.mock("../../state/agentSettings", async () => {
  const { AsyncResult, Atom } = await import("effect/unstable/reactivity");
  const family = Atom.family((key: string) => {
    const input = JSON.parse(key) as HarnessChatSyncListInput;
    return Atom.make(
      AsyncResult.success({
        chats: [],
        nextCursor: input.cursor ? null : "next",
        totalMatching: input.query === "different" ? 1 : 20,
        changedMatching: input.cursor ? 7 : 3,
        countsAreComplete: Boolean(input.cursor),
      }),
    );
  });
  return {
    agentSettingsEnvironment: {
      harnessChatSync: {
        listQuery: (target: { input: HarnessChatSyncListInput }) =>
          family(JSON.stringify(target.input)),
        sourcesQuery: () => Atom.make(AsyncResult.success({ sources: [] })),
      },
    },
  };
});

const environmentId = EnvironmentId.make("pagination-test");
const sourceId = HarnessChatSyncSourceId.make("codex");
let renderer: ReactTestRenderer | undefined;
let registry: AtomRegistry.AtomRegistry;
let view: ReturnType<typeof useHarnessChatPages>;
function Probe({ query = "", enabled = true }: { query?: string; enabled?: boolean }) {
  const next = useHarnessChatPages(
    environmentId,
    { sourceId, query, includeArchived: false, limit: 10 },
    enabled,
  );
  useLayoutEffect(() => {
    view = next;
  }, [next]);
  return null;
}
function render(query = "", enabled = true) {
  return (
    <RegistryContext.Provider value={registry}>
      <Probe query={query} enabled={enabled} />
    </RegistryContext.Provider>
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  await act(() => {
    renderer = create(render());
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});
it("loads the next page once and does not carry its cursor into a different search", async () => {
  expect(view.pages).toHaveLength(1);
  await act(() => {
    view.loadNext();
    view.loadNext();
  });
  expect(view.pages).toHaveLength(2);
  expect(view.pages[1]?.changedMatching).toBe(7);
  expect(view.hasNextPage).toBe(false);
  await act(() => renderer?.update(render("different")));
  expect(view.pages).toHaveLength(1);
  expect(view.pages[0]?.totalMatching).toBe(1);
  expect(view.hasNextPage).toBe(true);
});
it("refresh starts again at the first page and inactive panels return no cached data", async () => {
  await act(() => view.loadNext());
  expect(view.pages).toHaveLength(2);
  await act(() => view.refresh());
  expect(view.pages).toHaveLength(1);
  await act(() => renderer?.update(render("", false)));
  expect(view.pages).toEqual([]);
  expect(view.isPending).toBe(false);
});
