import { createContext, use, useCallback, useLayoutEffect, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ProjectThreadPreviewCount } from "@t3tools/contracts";

import { Uniwind } from "uniwind";

import {
  resolveAppearance,
  resolveAppearancePreferences,
  resolveTextScaleVariables,
  type ResolvedAppearance,
} from "../../../lib/appearancePreferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import { useProjectThreadPreviewSync } from "../../../state/use-project-thread-preview-sync";
import type { Preferences } from "../../../persistence/mobile-preferences";
import {
  createMobileThemePairPatch,
  createMobileThemeSelectionPatch,
  getMobileThemeVariables,
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../../lib/mobileTheme";
import { cacheTerminalFontSize } from "../../terminal/terminalUiState";

interface AppearancePreferencesContextValue {
  /** Effective values with base-size derivation applied. Use this for rendering. */
  readonly appearance: ResolvedAppearance & {
    readonly projectThreadPreviewCount: ProjectThreadPreviewCount;
  };
  readonly themeId: MobileThemeId;
  readonly themeIds: MobileThemeIds;
  readonly themeMode: MobileThemeMode;
  readonly themeAppearance: MobileThemeAppearance;
  readonly isReady: boolean;
  readonly setThemeIdForAppearance: (
    appearance: MobileThemeAppearance,
    value: MobileThemeId,
  ) => void;
  readonly setThemeIdForBothAppearances: (value: MobileThemeId) => void;
  readonly setThemeMode: (value: MobileThemeMode) => void;
  readonly setBaseFontSize: (value: number) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setTerminalFontSize: (value: number | null) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setCodeFontSize: (value: number | null) => void;
  readonly setCodeWordBreak: (value: boolean) => void;
  readonly setProjectThreadPreviewCount: (value: ProjectThreadPreviewCount) => void;
  readonly projectThreadPreviewSyncStatus: {
    readonly isSyncing: boolean;
    readonly failedEnvironmentLabels: readonly string[];
    readonly deferredEnvironmentLabels: readonly string[];
    readonly unsupportedEnvironmentLabels: readonly string[];
  };
}

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

/**
 * Injects palette and text-scale variables into both adaptive stylesheets.
 * Updating the active sheet last lets the visible app settle in one pass.
 */
function applyAppearanceVariables(baseFontSize: number, themeIds: MobileThemeIds) {
  const textVariables = resolveTextScaleVariables(baseFontSize);
  const currentTheme = Uniwind.currentTheme;
  const activeAppearance =
    currentTheme === "light" || currentTheme === "dark" ? currentTheme : null;

  for (const theme of ["light", "dark"] as const) {
    const variables = { ...getMobileThemeVariables(themeIds[theme], theme), ...textVariables };
    if (theme !== activeAppearance) {
      Uniwind.updateCSSVariables(theme, variables);
    }
  }
  if (activeAppearance !== null) {
    Uniwind.updateCSSVariables(activeAppearance, {
      ...getMobileThemeVariables(themeIds[activeAppearance], activeAppearance),
      ...textVariables,
    });
  }
}

export function AppearancePreferencesProvider(props: { readonly children: ReactNode }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const projectThreadPreviewSync = useProjectThreadPreviewSync();
  const systemColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  const preferences = useMemo(
    () => resolveAppearancePreferences(storedPreferences),
    [storedPreferences],
  );
  const themeMode = normalizeMobileThemeMode(storedPreferences?.themeMode);
  const themeAppearance = themeMode === "system" ? systemColorScheme : themeMode;
  const themeIds = useMemo(
    () => resolveMobileThemeIds(storedPreferences ?? {}),
    [storedPreferences],
  );
  const themeId = themeIds[themeAppearance];
  const isReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;

  useLayoutEffect(() => {
    applyAppearanceVariables(preferences.baseFontSize, themeIds);
    Uniwind.setTheme(themeMode);
    cacheTerminalFontSize(resolveAppearance(preferences).terminalFontSize);
  }, [preferences, themeIds, themeMode]);

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      savePreferences(patch);
    },
    [savePreferences],
  );

  const setThemeIdForAppearance = useCallback(
    (appearance: MobileThemeAppearance, value: MobileThemeId) => {
      updatePreferences(
        createMobileThemeSelectionPatch(themeIds, themeAppearance, appearance, value),
      );
    },
    [themeAppearance, themeIds, updatePreferences],
  );

  const setThemeIdForBothAppearances = useCallback(
    (value: MobileThemeId) => {
      updatePreferences(createMobileThemePairPatch(value));
    },
    [updatePreferences],
  );

  const setThemeMode = useCallback(
    (value: MobileThemeMode) => {
      updatePreferences({ themeMode: value });
    },
    [updatePreferences],
  );

  const setBaseFontSize = useCallback(
    (value: number) => {
      updatePreferences({ baseFontSize: value });
    },
    [updatePreferences],
  );

  const setTerminalFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ terminalFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ codeFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeWordBreak = useCallback(
    (value: boolean) => {
      updatePreferences({ codeWordBreak: value });
    },
    [updatePreferences],
  );

  const value = useMemo(
    (): AppearancePreferencesContextValue => ({
      appearance: {
        ...resolveAppearance(preferences),
        projectThreadPreviewCount: projectThreadPreviewSync.count,
      },
      themeId,
      themeIds,
      themeMode,
      themeAppearance,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
      setProjectThreadPreviewCount: projectThreadPreviewSync.setCount,
      projectThreadPreviewSyncStatus: {
        isSyncing: projectThreadPreviewSync.isSyncing,
        failedEnvironmentLabels: projectThreadPreviewSync.failedEnvironmentLabels,
        deferredEnvironmentLabels: projectThreadPreviewSync.deferredEnvironmentLabels,
        unsupportedEnvironmentLabels: projectThreadPreviewSync.unsupportedEnvironmentLabels,
      },
    }),
    [
      preferences,
      projectThreadPreviewSync,
      themeId,
      themeIds,
      themeMode,
      themeAppearance,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
    ],
  );

  return (
    <AppearancePreferencesContext.Provider value={value}>
      {props.children}
    </AppearancePreferencesContext.Provider>
  );
}

export function useAppearancePreferences(): AppearancePreferencesContextValue {
  const context = use(AppearancePreferencesContext);
  if (!context) {
    throw new Error("useAppearancePreferences must be used within AppearancePreferencesProvider");
  }
  return context;
}
