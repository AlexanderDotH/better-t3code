import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
  type ChatVisualMode,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";
import { resolveChatPresentation } from "@t3tools/client-runtime/chat-presentation";
import { useChatVisualModeSync } from "../../../state/use-chat-visual-mode-sync";
import { useProjectThreadPreviewSync } from "../../../state/use-project-thread-preview-sync";
import {
  useInterfaceLanguageSync,
  type MobileInterfaceLanguageSyncState,
} from "../../../state/use-interface-language-sync";
import {
  useCallback,
  useEffect,
  useState,
  createContext,
  startTransition,
  use,
  useMemo,
  type ReactNode,
} from "react";
import { AccessibilityInfo, AppState, Appearance, Platform, useColorScheme } from "react-native";

import { manufacturer } from "expo-device";
import {
  resolveAndroidNavigationStyle,
  type AndroidNavigationStyle,
} from "../../../lib/androidNavigationStyle";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom, AsyncResult } from "effect/reactivity";

import { ScopedTheme, ScopedVariables, Uniwind } from "uniwind";

import {
  resolveAppearance,
  resolveAppearancePreferences,
  type ResolvedAppearance,
} from "../../../lib/appearancePreferences";
import { appAtomRegistry } from "../../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import type { Preferences } from "../../../persistence/mobile-preferences";
import {
  isSystemColorsAvailable,
  readSystemColorPalettes,
  type MaterialYouPalettes,
} from "../../../lib/materialYouPalette";
import { materialYouPaletteToMobileThemeVariables } from "../../../lib/materialYouTheme";
import { getMobileThemeRuntimeVariables } from "../../../lib/mobileThemeVariables";
import type { MobileThemeVariables } from "../../../lib/mobileTheme";
import {
  createMobileThemePairPatch,
  createMobileThemeSelectionPatch,
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../../lib/mobileTheme";
import {
  createMobileThemeRuntimeOperations,
  getMobileUniwindThemeName,
  type MobileThemeRuntimeState,
} from "../../../lib/mobileThemeRuntime";

interface AppearancePreferencesContextValue {
  readonly appearance: ResolvedAppearance & {
    readonly projectThreadPreviewCount: ProjectThreadPreviewCount;
  };
  readonly themeId: MobileThemeId;
  readonly themeIds: MobileThemeIds;
  readonly themeMode: MobileThemeMode;
  readonly androidNavigationStyle: AndroidNavigationStyle;
  readonly setAndroidNavigationStyle: (value: AndroidNavigationStyle) => void;
  readonly themeAppearance: MobileThemeAppearance;
  readonly systemColorsAvailable: boolean;
  readonly systemColorsActive: boolean;
  readonly themeVariables: MobileThemeVariables;
  readonly themeVariablesByAppearance: Readonly<
    Record<MobileThemeAppearance, MobileThemeVariables>
  >;
  readonly systemColorPalettes: ReturnType<typeof readSystemColorPalettes>;
  readonly isReady: boolean;
  readonly setThemeIdForAppearance: (
    appearance: MobileThemeAppearance,
    value: MobileThemeId,
  ) => void;
  readonly setThemeIdForBothAppearances: (value: MobileThemeId) => void;
  readonly setThemeMode: (value: MobileThemeMode) => void;
  readonly setBaseFontSize: (value: number) => void;
  readonly setTerminalFontSize: (value: number | null) => void;
  readonly setCodeFontSize: (value: number | null) => void;
  readonly setCodeWordBreak: (value: boolean) => void;
  readonly mathRenderingEnabled: boolean;
  readonly setMathRenderingEnabled: (value: boolean) => void;
  readonly setProjectThreadPreviewCount: (value: ProjectThreadPreviewCount) => void;
  readonly chatVisualMode: ChatVisualMode;
  readonly chatPresentation: ReturnType<typeof resolveChatPresentation>;
  readonly presentationMotion: boolean;
  readonly setPresentationMotion: (value: boolean) => void;
  readonly setChatVisualMode: (value: ChatVisualMode) => void;
  readonly chatVisualModeSyncStatus: {
    readonly isLocalOnly: boolean;
    readonly isSyncing: boolean;
    readonly failedEnvironmentLabels: readonly string[];
    readonly deferredEnvironmentLabels: readonly string[];
    readonly unsupportedEnvironmentLabels: readonly string[];
  };
  readonly projectThreadPreviewSyncStatus: {
    readonly isSyncing: boolean;
    readonly failedEnvironmentLabels: readonly string[];
    readonly deferredEnvironmentLabels: readonly string[];
    readonly unsupportedEnvironmentLabels: readonly string[];
  };
  readonly interfaceLanguage: MobileInterfaceLanguageSyncState;
}

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

function storedPreferencesOf<E>(result: AsyncResult.AsyncResult<Preferences, E>) {
  return AsyncResult.isSuccess(result) ? result.value : null;
}

/**
 * Material You palettes follow the system wallpaper, which can change while the
 * app is in the background.
 */
const systemColorPalettesAtom = Atom.make((get): MaterialYouPalettes | null => {
  const initial = readSystemColorPalettes();
  if (!isSystemColorsAvailable) return initial;
  let current = initial;
  const refresh = () => {
    const next = readSystemColorPalettes();
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    current = next;
    get.setSelf(next);
  };
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  const focusSubscription = AppState.addEventListener("focus", refresh);
  get.addFinalizer(() => {
    subscription.remove();
    focusSubscription.remove();
  });
  return initial;
}).pipe(Atom.withLabel("mobile:system-color-palettes"));

function resolveThemeVariablesByAppearance(
  themeIds: MobileThemeIds,
  palettes: MaterialYouPalettes | null,
): Readonly<Record<MobileThemeAppearance, MobileThemeVariables>> {
  const resolve = (appearance: MobileThemeAppearance) => {
    const base = getMobileThemeRuntimeVariables(themeIds[appearance], appearance, Platform.OS);
    return themeIds[appearance] === "material-you" && palettes
      ? materialYouPaletteToMobileThemeVariables(palettes[appearance], appearance, base)
      : base;
  };
  return { light: resolve("light"), dark: resolve("dark") };
}

/** The appearance whose theme is on screen, read from the native scheme. */
export function resolveThemeAppearance(stored: Preferences | null): MobileThemeAppearance {
  const themeMode = normalizeMobileThemeMode(stored?.themeMode);
  if (themeMode !== "system") return themeMode;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

function runtimeStateFor(stored: Preferences | null): MobileThemeRuntimeState {
  return {
    baseFontSize: resolveAppearancePreferences(stored).baseFontSize,
    themeMode: normalizeMobileThemeMode(stored?.themeMode),
    themeAppearance: resolveThemeAppearance(stored),
  };
}

const themeRuntimeStateAtom = Atom.make((get) =>
  runtimeStateFor(storedPreferencesOf(get(mobilePreferencesAtom))),
).pipe(
  Atom.withEquality(
    (left: MobileThemeRuntimeState, right: MobileThemeRuntimeState) =>
      left.baseFontSize === right.baseFontSize &&
      left.themeMode === right.themeMode &&
      left.themeAppearance === right.themeAppearance,
  ),
);

// Native appearance and Uniwind text variables are process-global, so the
// last applied state is too. Setters apply ahead of the preference write so the
// first frame after a change already uses it; the atom subscription then sees
// no difference.
let appliedRuntimeState: MobileThemeRuntimeState | null = null;

function applyThemeRuntime(next: MobileThemeRuntimeState) {
  for (const operation of createMobileThemeRuntimeOperations(appliedRuntimeState, next)) {
    if (operation.kind === "update-text-variables") {
      Uniwind.updateCSSVariables(operation.themeName, operation.variables);
      continue;
    }
    if (operation.kind === "set-appearance-mode") {
      Appearance.setColorScheme(
        operation.themeMode === "system" ? "unspecified" : operation.appearance,
      );
    }
  }
  appliedRuntimeState = next;
}

function currentRuntimeState() {
  return appliedRuntimeState ?? appAtomRegistry.get(themeRuntimeStateAtom);
}

/**
 * App-lifetime: applies theme preferences to the native runtime and holds the
 * system palette listeners. Holding them here instead of `keepAlive` lets the
 * fast-refresh disposer release the replaced module's AppState listeners.
 */
export function installAppearanceRuntime(): () => void {
  const unsubscribeRuntime = appAtomRegistry.subscribe(themeRuntimeStateAtom, applyThemeRuntime, {
    immediate: true,
  });
  const releasePalettes = appAtomRegistry.mount(systemColorPalettesAtom);
  return () => {
    unsubscribeRuntime();
    releasePalettes();
  };
}

export function AppearancePreferencesProvider(props: { readonly children: ReactNode }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const chatVisualModeSync = useChatVisualModeSync();
  const projectThreadPreviewSync = useProjectThreadPreviewSync();
  const interfaceLanguage = useInterfaceLanguageSync();
  const systemColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  const [reducedMotion, setReducedMotion] = useState(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the native reduced-motion preference in sync while this provider is mounted.
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const presentationMotion = resolveBetterT3FeatureFlag(
    storedPreferences?.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    "chat.presentationMotion",
  );
  const chatPresentation = useMemo(
    () =>
      resolveChatPresentation({
        mode: chatVisualModeSync.mode,
        presentationMotion,
        // Native markdown has no character-streaming renderer.
        characterStreamingMotion: false,
        reducedMotion,
      }),
    [chatVisualModeSync.mode, presentationMotion, reducedMotion],
  );
  const preferences = useMemo(
    () => resolveAppearancePreferences(storedPreferences),
    [storedPreferences],
  );
  const androidNavigationStyle = resolveAndroidNavigationStyle(
    storedPreferences?.androidNavigationStyle,
    manufacturer,
    process.env.EXPO_PUBLIC_T3_FLOATING_TABS === "1",
  );
  const themeMode = normalizeMobileThemeMode(storedPreferences?.themeMode);
  const themeAppearance = themeMode === "system" ? systemColorScheme : themeMode;
  const resolvedThemeIds = resolveMobileThemeIds(storedPreferences ?? {});
  const themeIds = useMemo<MobileThemeIds>(
    () => ({ light: resolvedThemeIds.light, dark: resolvedThemeIds.dark }),
    [resolvedThemeIds.dark, resolvedThemeIds.light],
  );
  const themeId = themeIds[themeAppearance];
  const systemColorsActive = themeId === "material-you" && isSystemColorsAvailable;
  const systemColorPalettes = useAtomValue(systemColorPalettesAtom);
  const themeVariablesByAppearance = resolveThemeVariablesByAppearance(
    themeIds,
    systemColorPalettes,
  );
  const themeVariables = themeVariablesByAppearance[themeAppearance];
  const activeThemeName = getMobileUniwindThemeName(themeId, themeAppearance);
  const { baseFontSize, codeFontSize, codeWordBreak, terminalFontSize } = preferences;
  const appearance = useMemo(
    () => resolveAppearance({ baseFontSize, codeFontSize, codeWordBreak, terminalFontSize }),
    [baseFontSize, codeFontSize, codeWordBreak, terminalFontSize],
  );
  const isReady = AsyncResult.isSuccess(preferencesResult);
  const updatePreferences = (patch: Partial<Preferences>) => {
    startTransition(() => savePreferences(patch));
  };

  const updateThemePreferences = (patch: Partial<Preferences>) => {
    savePreferences(patch);
  };

  const setThemeIdForAppearance = (appearance: MobileThemeAppearance, value: MobileThemeId) => {
    // Read at call time: a second pick before the next render must build on
    // the first one's optimistic write.
    const selected = resolveMobileThemeIds(
      storedPreferencesOf(appAtomRegistry.get(mobilePreferencesAtom)) ?? {},
    );
    updateThemePreferences(
      createMobileThemeSelectionPatch(selected, themeAppearance, appearance, value),
    );
  };

  const setThemeIdForBothAppearances = (value: MobileThemeId) => {
    updateThemePreferences(createMobileThemePairPatch(value));
  };

  const setThemeMode = (value: MobileThemeMode) => {
    const current = currentRuntimeState();

    // Clear forced appearance before publishing System so useColorScheme batches the system palette into the preference commit.
    if (value === "system") {
      Appearance.setColorScheme("unspecified");
    }
    const nextAppearance =
      value === "system" ? (Appearance.getColorScheme() === "dark" ? "dark" : "light") : value;
    const next = {
      ...current,
      themeAppearance: nextAppearance,
      themeMode: value,
    };

    if (value === "system") {
      appliedRuntimeState = next;
    } else {
      applyThemeRuntime(next);
    }
    updateThemePreferences({ themeMode: value });
  };

  const setAndroidNavigationStyle = (value: AndroidNavigationStyle) =>
    updatePreferences({ androidNavigationStyle: value });

  const setBaseFontSize = (value: number) => {
    applyThemeRuntime({ ...currentRuntimeState(), baseFontSize: value });
    updatePreferences({ baseFontSize: value });
  };

  const setTerminalFontSize = (value: number | null) => {
    updatePreferences({ terminalFontSize: value });
  };

  const setCodeFontSize = (value: number | null) => {
    updatePreferences({ codeFontSize: value });
  };

  const setCodeWordBreak = (value: boolean) => {
    updatePreferences({ codeWordBreak: value });
  };

  const mathRenderingEnabled = storedPreferences?.mathRenderingEnabled === true;
  const setMathRenderingEnabled = (value: boolean) =>
    updatePreferences({ mathRenderingEnabled: value });

  const setPresentationMotion = useCallback(
    (value: boolean) => {
      savePreferences({
        transform: (current) => ({
          betterT3Device: {
            ...(current.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1),
            flags: { ...current.betterT3Device?.flags, "chat.presentationMotion": value },
          },
        }),
      });
    },
    [savePreferences],
  );

  const value = useMemo(
    (): AppearancePreferencesContextValue => ({
      appearance: { ...appearance, projectThreadPreviewCount: projectThreadPreviewSync.count },
      themeId,
      themeIds,
      themeMode,
      androidNavigationStyle,
      setAndroidNavigationStyle,
      themeAppearance,
      systemColorsAvailable: isSystemColorsAvailable,
      systemColorsActive,
      themeVariables,
      themeVariablesByAppearance,
      systemColorPalettes,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
      chatVisualMode: chatVisualModeSync.mode,
      chatPresentation,
      presentationMotion,
      setPresentationMotion,
      setChatVisualMode: chatVisualModeSync.setMode,
      chatVisualModeSyncStatus: {
        isLocalOnly: chatVisualModeSync.isLocalOnly,
        isSyncing: chatVisualModeSync.isSyncing,
        failedEnvironmentLabels: chatVisualModeSync.failedEnvironmentLabels,
        deferredEnvironmentLabels: chatVisualModeSync.deferredEnvironmentLabels,
        unsupportedEnvironmentLabels: chatVisualModeSync.unsupportedEnvironmentLabels,
      },
      setProjectThreadPreviewCount: projectThreadPreviewSync.setCount,
      projectThreadPreviewSyncStatus: {
        isSyncing: projectThreadPreviewSync.isSyncing,
        failedEnvironmentLabels: projectThreadPreviewSync.failedEnvironmentLabels,
        deferredEnvironmentLabels: projectThreadPreviewSync.deferredEnvironmentLabels,
        unsupportedEnvironmentLabels: projectThreadPreviewSync.unsupportedEnvironmentLabels,
      },
      interfaceLanguage,
      mathRenderingEnabled,
      setMathRenderingEnabled,
    }),
    [
      chatVisualModeSync,
      chatPresentation,
      presentationMotion,
      setPresentationMotion,
      projectThreadPreviewSync,
      interfaceLanguage,
      appearance,
      themeId,
      themeIds,
      themeMode,
      androidNavigationStyle,
      setAndroidNavigationStyle,
      themeAppearance,
      systemColorsActive,
      themeVariables,
      themeVariablesByAppearance,
      systemColorPalettes,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
      mathRenderingEnabled,
      setMathRenderingEnabled,
    ],
  );

  return (
    <AppearancePreferencesContext.Provider value={value}>
      <ScopedTheme theme={activeThemeName}>
        <ScopedVariables variables={themeVariables}>{props.children}</ScopedVariables>
      </ScopedTheme>
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

export function useAndroidFloatingTabs() {
  const { androidNavigationStyle } = useAppearancePreferences();
  return Platform.OS === "android" && androidNavigationStyle === "one-ui";
}
