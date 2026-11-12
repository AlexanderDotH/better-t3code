import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { DEFAULT_SIDEBAR_PROJECT_SORT_ORDER } from "@t3tools/contracts";
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { createContext, createElement, useContext, useState, type PropsWithChildren } from "react";

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import type { HomeProjectSortOrder } from "./homeThreadList";

export interface HomeListOptions {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly projectSortOrder: HomeProjectSortOrder;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

function defaultHomeListOptions(filters?: ThreadListFilters): HomeListOptions {
  return {
    selectedEnvironmentId: filters?.environmentId ?? null,
    selectedProjectKey:
      filters?.projectKeys?.length === 1
        ? filters.projectKeys[0]!
        : filters?.projectKeys?.length
          ? null
          : (filters?.projectKey ?? null),
    selectedProjectKeys: filters?.projectKeys ?? (filters?.projectKey ? [filters.projectKey] : []),
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  };
}

type HomeListOptionsUpdate =
  | Partial<HomeListOptions>
  | ((current: HomeListOptions) => Partial<HomeListOptions>);

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly updateOptions: (update: HomeListOptionsUpdate) => void;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

const HomeListOptionsContext = createContext<HomeListOptionsContextValue | null>(null);

export function HomeListOptionsProvider({
  children,
  projectGroupingMode,
  savedFilters,
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly savedFilters?: ThreadListFilters | undefined;
}>) {
  const registry = useContext(RegistryContext);
  const [optionsAtom] = useState(() => Atom.make(defaultHomeListOptions(savedFilters)));
  const options = useAtomValue(optionsAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  // Only the scope persists; the sort order is per session. Updates read the
  // registry, so several in one event each build on the last and save it.
  const updateOptions = (update: HomeListOptionsUpdate) => {
    const current = registry.get(optionsAtom);
    const patch = typeof update === "function" ? update(current) : update;
    const next = { ...current, ...patch };
    registry.set(optionsAtom, next);
    if (
      next.selectedEnvironmentId !== current.selectedEnvironmentId ||
      next.selectedProjectKey !== current.selectedProjectKey ||
      next.selectedProjectKeys !== current.selectedProjectKeys
    ) {
      savePreferences({
        threadListFilters: {
          environmentId: next.selectedEnvironmentId,
          projectKey: next.selectedProjectKey,
          ...(next.selectedProjectKeys.length > 1 ? { projectKeys: next.selectedProjectKeys } : {}),
        },
      });
    }
  };
  const value = { options, updateOptions, projectGroupingMode };
  return createElement(HomeListOptionsContext, { value }, children);
}

export function useHomeListOptions(availableEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const shared = useContext(HomeListOptionsContext);
  const [localOptions, setLocalOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const options = shared?.options ?? localOptions;
  const updateOptions =
    shared?.updateOptions ??
    ((update: HomeListOptionsUpdate) =>
      setLocalOptions((current) => ({
        ...current,
        ...(typeof update === "function" ? update(current) : update),
      })));
  const selectedEnvironmentId =
    options.selectedEnvironmentId !== null &&
    availableEnvironmentIds.has(options.selectedEnvironmentId)
      ? options.selectedEnvironmentId
      : null;
  const availableOptions =
    selectedEnvironmentId === options.selectedEnvironmentId
      ? options
      : { ...options, selectedEnvironmentId };
  const resolvedOptions: ResolvedHomeListOptions = {
    ...availableOptions,
    projectGroupingMode: shared?.projectGroupingMode ?? "repository",
  };

  const setSelectedEnvironmentId = (value: EnvironmentId | null) => {
    updateOptions({ selectedEnvironmentId: value });
  };
  const setSelectedProjectKey = (value: string | null) => {
    updateOptions({
      selectedProjectKey: value,
      selectedProjectKeys: value === null ? [] : [value],
    });
  };
  const setSelectedProjectKeys = (values: ReadonlyArray<string>) => {
    const keys = [...new Set(values)];
    updateOptions({
      selectedProjectKeys: keys,
      selectedProjectKey: keys.length === 1 ? keys[0]! : null,
    });
  };
  const toggleSelectedProjectKey = (key: string | null) => {
    updateOptions((current) => {
      const keys =
        key === null
          ? []
          : current.selectedProjectKeys.includes(key)
            ? current.selectedProjectKeys.filter((value) => value !== key)
            : [...current.selectedProjectKeys, key];
      return { selectedProjectKeys: keys, selectedProjectKey: keys.length === 1 ? keys[0]! : null };
    });
  };
  const setProjectSortOrder = (value: HomeProjectSortOrder) => {
    updateOptions({ projectSortOrder: value });
  };
  return {
    options: resolvedOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
    setSelectedProjectKeys,
    toggleSelectedProjectKey,
    setProjectSortOrder,
  } as const;
}
