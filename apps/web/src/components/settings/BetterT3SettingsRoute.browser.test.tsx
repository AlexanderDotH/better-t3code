import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";

import { getRouter } from "~/router";
import { installFakeEnvironment, type FakeDriver } from "../../../test/fakeEnvironment";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

it.each([
  ["/settings/better-t3", "general", ""],
  ["/settings/better-t3?category=chat", "chat", ""],
  ["/settings/better-t3#agent.fetchModel", "agents", "agent.fetchModel"],
  ["/settings/better-t3?category=chat#voice-cleanup-model", "voice", "voice-cleanup-model"],
])("opens %s on the %s page and keeps its deep link", async (entry, category, hash) => {
  using _environment = installFakeEnvironment([]);
  const router = getRouter(createMemoryHistory({ initialEntries: [entry] }));
  await router.load();
  expect(router.state.location.pathname).toBe("/settings/better-t3");
  expect(router.state.location.search).toMatchObject({ category });
  expect(router.state.location.hash).toBe(hash);
});
