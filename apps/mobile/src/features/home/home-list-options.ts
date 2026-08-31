import type {
  EnvironmentId,
  SidebarProjectGroupingMode,
  SidebarThreadSortOrder,
} from "@t3tools/contracts";
import {
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
} from "@t3tools/contracts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { Preferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import type { HomeProjectSortOrder } from "./homeThreadList";

export { PROJECT_SORT_OPTIONS, THREAD_SORT_OPTIONS } from "./home-list-sort-options";

export interface HomeListOptions {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly threadSortOrder: SidebarThreadSortOrder;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

function defaultHomeListOptions(): HomeListOptions {
  return {
    selectedEnvironmentId: null,
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
    threadSortOrder: DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  };
}

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly setOptions: Dispatch<SetStateAction<HomeListOptions>>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

const HomeListOptionsContext = createContext<HomeListOptionsContextValue | null>(null);

/** Keeps list preferences stable while the app moves between compact and split shells. */
export function HomeListOptionsProvider({
  children,
  projectGroupingMode,
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}>) {
  const [options, setOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const value = useMemo(
    () => ({ options, setOptions, projectGroupingMode }),
    [options, projectGroupingMode],
  );
  return createElement(HomeListOptionsContext, { value }, children);
}

export function hasCustomHomeListOptions(
  options: HomeListOptions & {
    readonly selectedProjectKey?: string | null;
  },
): boolean {
  const defaultProjectSortOrder =
    DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
      ? "updated_at"
      : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER;
  return (
    options.selectedEnvironmentId !== null ||
    (options.selectedProjectKey !== null && options.selectedProjectKey !== undefined) ||
    options.projectSortOrder !== defaultProjectSortOrder ||
    options.threadSortOrder !== DEFAULT_SIDEBAR_THREAD_SORT_ORDER
  );
}

export function resolvePersistedHomeListOptions(
  options: HomeListOptions,
  preferences: Pick<Preferences, "sidebarProjectSortOrder" | "sidebarThreadSortOrder">,
): HomeListOptions {
  return {
    ...options,
    projectSortOrder: preferences.sidebarProjectSortOrder ?? options.projectSortOrder,
    threadSortOrder: preferences.sidebarThreadSortOrder ?? options.threadSortOrder,
  };
}

export function useHomeListOptions(availableEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const shared = useContext(HomeListOptionsContext);
  const [localOptions, setLocalOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const options = shared?.options ?? localOptions;
  const setOptions = shared?.setOptions ?? setLocalOptions;
  const selectedEnvironmentId =
    options.selectedEnvironmentId !== null &&
    availableEnvironmentIds.has(options.selectedEnvironmentId)
      ? options.selectedEnvironmentId
      : null;
  const availableOptions =
    selectedEnvironmentId === options.selectedEnvironmentId
      ? options
      : { ...options, selectedEnvironmentId };
  const persistedOptions = resolvePersistedHomeListOptions(
    availableOptions,
    AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {},
  );
  const resolvedOptions: ResolvedHomeListOptions = {
    ...persistedOptions,
    projectGroupingMode: shared?.projectGroupingMode ?? "repository",
  };

  const setSelectedEnvironmentId = useCallback((value: EnvironmentId | null) => {
    setOptions((current) => ({ ...current, selectedEnvironmentId: value }));
  }, []);
  const setProjectSortOrder = useCallback(
    (value: HomeProjectSortOrder) => {
      setOptions((current) => ({ ...current, projectSortOrder: value }));
      savePreferences({ sidebarProjectSortOrder: value });
    },
    [savePreferences, setOptions],
  );
  const setThreadSortOrder = useCallback(
    (value: SidebarThreadSortOrder) => {
      setOptions((current) => ({ ...current, threadSortOrder: value }));
      savePreferences({ sidebarThreadSortOrder: value });
    },
    [savePreferences, setOptions],
  );
  return {
    options: resolvedOptions,
    setSelectedEnvironmentId,
    setProjectSortOrder,
    setThreadSortOrder,
  } as const;
}
