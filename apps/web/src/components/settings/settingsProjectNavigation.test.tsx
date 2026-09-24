import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { SettingsPageContainer, SettingsRow } from "./settingsLayout";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("keeps the project, machine, and checkout selected after scrolling to indexing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/settings/projects",
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => (
      <SettingsPageContainer>
        <SettingsRow id="project-indexing-enabled" title="Enable indexing" />
      </SettingsPageContainer>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        "/settings/projects?project=repo-a&machine=remote-b&indexing=checkout-c#project-indexing-enabled",
      ],
    }),
  });
  await router.load();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const scroll = vi.fn();
  const focus = vi.fn();
  await act(async () => {
    renderer = create(<RouterProvider router={router} />, {
      createNodeMock: (element) =>
        (element.props as { id?: string }).id === "project-indexing-enabled"
          ? {
              tagName: "DIV",
              dataset: {},
              scrollIntoView: scroll,
              focus,
              classList: { remove: vi.fn() },
            }
          : null,
    });
  });
  expect(scroll).toHaveBeenCalled();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(router.state.location.hash).toBe("");
  expect(router.state.location.search).toEqual({
    project: "repo-a",
    machine: "remote-b",
    indexing: "checkout-c",
  });
});
