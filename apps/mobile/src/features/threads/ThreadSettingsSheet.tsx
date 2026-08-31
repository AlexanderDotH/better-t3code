import type {
  EnvironmentId,
  ModelSelection,
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { HeaderHeightContext } from "@react-navigation/elements";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isAutoReasoningEnabled,
} from "@t3tools/shared/model";
import {
  DEFAULT_OPENROUTER_MODEL_FILTERS,
  modelFavoriteKey,
  type OpenRouterModelFilter,
} from "@t3tools/shared/modelCatalogFilters";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { useEnvironmentServerConfig } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { resolveMobileAgentWorkflowSettings } from "../../state/agent-workflow-settings";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import {
  NativeHeaderToolbar,
  NativeStackScreenOptions,
  nativeHeaderScrollEdgeEffects,
} from "../../native/StackHeader";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { serverEnvironment } from "../../state/server";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewTaskFlow } from "./new-task-flow-provider";
import {
  createProviderCatalogRefreshRunner,
  providerCatalogRefreshError,
} from "./provider-catalog-refresh";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import {
  applyThreadOptionChoice,
  RUNTIME_MODE_CHOICES,
  threadReasoningChoices,
} from "./thread-settings-options";
import { threadReasoningValueLabel, type AutoReasoningStatus } from "./thread-settings-summary";
import {
  MOBILE_MODEL_FILTER_MIN_TOUCH_TARGET,
  filterOpenRouterProviderCatalog,
  modelFavoriteActionMessageKey,
  modelMatchesCatalogQuery,
  pendingModelAfterPress,
  performModelFavoriteToggle,
  providerCatalogUsesDrillIn,
  providerSectionIsCollapsed,
} from "./thread-settings-sheet-state";

/**
 * Everyday harnesses start expanded; every other provider (OpenRouter catalogs
 * and friends) starts folded so a 300-model catalog cannot bury the list. All
 * provider headers remain user-collapsible.
 */
const PRIMARY_PROVIDER_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);
/**
 * Keep measured row changes stable, but let catalog mutations use the list's
 * native bounds so a filtered catalog that underflows returns to the top.
 */
const THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  data: false,
  size: true,
} as const;
const THREAD_SETTINGS_CATALOG_LAYOUT_TRANSITION = LinearTransition.duration(180);
const THREAD_SETTINGS_CATALOG_ENTER_TRANSITION = FadeIn.duration(140);
const THREAD_SETTINGS_CATALOG_EXIT_TRANSITION = FadeOut.duration(120);
const THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION = LinearTransition.duration(180);
const THREAD_SETTINGS_OPTION_ENTER_TRANSITION = FadeIn.duration(140);
const THREAD_SETTINGS_OPTION_EXIT_TRANSITION = FadeOut.duration(100);
const THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(
  Platform.OS,
  Platform.Version,
);
const OPENROUTER_FILTER_LABELS: ReadonlyArray<{
  readonly id: OpenRouterModelFilter;
  readonly messageKey: InterfaceMessageKey;
}> = [
  { id: "agent-ready", messageKey: "mobile.thread.settings.filterAgentReady" },
  { id: "free", messageKey: "mobile.thread.settings.filterFree" },
  { id: "reasoning", messageKey: "mobile.thread.settings.filterReasoning" },
  { id: "vision", messageKey: "mobile.thread.settings.filterVision" },
  { id: "128k", messageKey: "mobile.thread.settings.filter128k" },
];

function ModelRow(props: {
  readonly option: ModelOption;
  readonly selected: boolean;
  readonly favorite: boolean;
  readonly onPress: () => void;
  readonly onToggleFavorite: () => void;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Pressable
      accessibilityLabel={[props.option.label, props.option.subtitle].filter(Boolean).join(", ")}
      accessibilityHint={props.option.unavailableReason ?? undefined}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: !props.option.isSelectable }}
      onPress={props.option.isSelectable ? props.onPress : undefined}
      className={cn(
        "mx-4 min-h-11 flex-row items-center gap-2 bg-card px-4 py-2 active:bg-subtle",
        props.isFirst && "rounded-t-2xl",
        props.isLast ? "rounded-b-2xl" : "border-b border-border-subtle",
        !props.option.isSelectable && "opacity-60",
      )}
    >
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 shrink text-base font-t3-medium text-foreground"
            numberOfLines={1}
          >
            {props.option.label}
          </Text>
          {props.option.isDefault ? (
            <View className="rounded-md bg-subtle-strong px-1.5 py-0.5">
              <Text className="text-3xs font-t3-bold text-foreground-muted">
                {translator.message("mobile.thread.settings.default")}
              </Text>
            </View>
          ) : null}
          {props.option.isLegacy ? (
            <View className="rounded-md bg-subtle px-1.5 py-0.5">
              <Text className="text-3xs font-t3-bold text-foreground-muted">
                {translator.message("mobile.thread.settings.legacy")}
              </Text>
            </View>
          ) : null}
        </View>
        {props.option.unavailableReason || props.option.subtitle ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {props.option.unavailableReason ?? props.option.subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={translator.message(modelFavoriteActionMessageKey(props.favorite), {
          model: props.option.label,
        })}
        accessibilityRole="button"
        hitSlop={8}
        onPress={(event) => performModelFavoriteToggle(event, props.onToggleFavorite)}
        className="size-8 items-center justify-center rounded-full active:bg-subtle"
      >
        <SymbolView
          name={{
            ios: props.favorite ? "star.fill" : "star",
            android: props.favorite ? "star" : "star_border",
          }}
          size={17}
          tintColorClassName={props.favorite ? "accent-icon" : "accent-icon-subtle"}
          type="monochrome"
        />
      </Pressable>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColorClassName={"accent-icon"}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}
/** Provider catalog header with its harness logo and disclosure state. */
function ProviderHeader(props: {
  readonly driver: string | undefined;
  readonly label: string;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly opensCatalog: boolean;
  readonly modelCount: number;
  readonly onPress: () => void;
}) {
  const content = (
    <>
      <ProviderIcon provider={props.driver} size={15} />
      <Text className="text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      {props.collapsible || props.opensCatalog ? (
        <>
          <View className="flex-1" />
          {props.collapsed || props.opensCatalog ? (
            <Text className="text-2xs font-t3-medium text-foreground-muted">
              {props.modelCount}
            </Text>
          ) : null}
          <SymbolView
            name={
              props.opensCatalog ? "chevron.right" : props.collapsed ? "chevron.down" : "chevron.up"
            }
            size={12}
            tintColorClassName={"accent-icon-subtle"}
            type="monochrome"
          />
        </>
      ) : null}
    </>
  );

  if (props.collapsible || props.opensCatalog) {
    return (
      <Pressable
        accessibilityLabel={`${props.label}, ${props.modelCount} models`}
        accessibilityRole="button"
        accessibilityState={props.collapsible ? { expanded: !props.collapsed } : undefined}
        className="mx-4 mt-1 min-h-11 flex-row items-center gap-2 rounded-xl px-1 pt-2 active:opacity-60"
        onPress={props.onPress}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessibilityRole="header" className="mx-4 min-h-9 flex-row items-center gap-2 px-1 pt-1">
      {content}
    </View>
  );
}

/** Compact row that opens a single-choice submenu panel. */
function DisclosureRow(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly onPress: () => void;
  readonly isLast?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className={cn(
        "min-h-11 flex-row items-center gap-2 bg-card px-4 py-2 active:bg-subtle",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <View className="flex-1" />
      {props.value ? (
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
      ) : null}
      <SymbolView
        name="chevron.right"
        size={12}
        tintColorClassName={"accent-icon-subtle"}
        type="monochrome"
      />
    </Pressable>
  );
}

/** Single option inside a submenu panel. */
function ChoiceRow(props: {
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly isLast: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={props.description ? `${props.label}. ${props.description}` : props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      className={cn(
        "min-h-14 flex-row items-center gap-3 bg-card px-4 py-3 active:bg-subtle",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
        {props.description ? (
          <Text className="text-sm leading-5 text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColorClassName={"accent-icon"}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

function SwitchRow(props: {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly isLast?: boolean;
}) {
  return (
    <View
      className={cn(
        "min-h-11 flex-row items-center justify-between bg-card px-4 py-1",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <ThemedSwitch
        accessibilityLabel={props.label}
        onValueChange={props.onValueChange}
        value={props.value}
      />
    </View>
  );
}

type ThreadSettingsSubmenuPage =
  | { readonly kind: "descriptor"; readonly id: string }
  | { readonly kind: "runtime" };

type ThreadSettingsSessionProps = {
  readonly environmentId: EnvironmentId | null;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly fetchSupported?: boolean;
  readonly fetchEnabled?: boolean;
  readonly onUpdateFetchEnabled?: (enabled: boolean) => void;
  readonly onCopyTranscript?: () => Promise<void>;
  readonly transcriptExportBusy?: boolean;
  readonly autoReasoningStatus?: AutoReasoningStatus;
};

export type ExistingThreadSettingsRouteSession = ThreadSettingsSessionProps & {
  readonly ownerId: string;
};

type ExistingThreadSettingsRouteContextValue = {
  readonly session: ExistingThreadSettingsRouteSession | null;
  readonly present: (session: ExistingThreadSettingsRouteSession) => void;
  readonly clear: (ownerId: string) => void;
};

const ExistingThreadSettingsRouteContext =
  createContext<ExistingThreadSettingsRouteContextValue | null>(null);

/** Bridges the active thread's settings state into the root native sheet route. */
export function ExistingThreadSettingsRouteProvider(props: { readonly children: ReactNode }) {
  const [session, setSession] = useState<ExistingThreadSettingsRouteSession | null>(null);
  const present = useCallback((nextSession: ExistingThreadSettingsRouteSession) => {
    setSession(nextSession);
  }, []);
  const clear = useCallback((ownerId: string) => {
    setSession((current) => (current?.ownerId === ownerId ? null : current));
  }, []);
  const value = useMemo(() => ({ session, present, clear }), [clear, present, session]);

  return (
    <ExistingThreadSettingsRouteContext.Provider value={value}>
      {props.children}
    </ExistingThreadSettingsRouteContext.Provider>
  );
}

export function useExistingThreadSettingsRoutePresentation() {
  const value = use(ExistingThreadSettingsRouteContext);
  if (!value) {
    throw new Error(
      "useExistingThreadSettingsRoutePresentation must be used inside ExistingThreadSettingsRouteProvider.",
    );
  }
  return value;
}

type ThreadSettingsSessionValue = {
  readonly environmentId: EnvironmentId | null;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly fetchSupported: boolean;
  readonly fetchEnabled: boolean;
  readonly onUpdateFetchEnabled: ((enabled: boolean) => void) | undefined;
  readonly onCopyTranscript: (() => Promise<void>) | undefined;
  readonly transcriptExportBusy: boolean;
  readonly displayedDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly displayedProvider: ProviderDriverKind | null;
  readonly autoReasoningEnabled: boolean;
  readonly autoReasoningStatus: AutoReasoningStatus | null;
  readonly providerExpansionOverrides: ReadonlySet<string>;
  readonly hasLegacyModels: boolean;
  readonly pendingModel: ModelOption | null;
  readonly providerFilter: string | null;
  readonly searchQuery: string;
  readonly showLegacy: boolean;
  readonly openRouterFilters: ReadonlySet<OpenRouterModelFilter>;
  readonly applyOptionChange: (id: string, value: string | boolean) => void;
  readonly commitPendingModel: () => void;
  readonly isApplied: (option: ModelOption) => boolean;
  readonly isDisplayed: (option: ModelOption) => boolean;
  readonly isFavorite: (option: ModelOption) => boolean;
  readonly pressModel: (option: ModelOption) => void;
  readonly setProviderFilter: (providerKey: string | null) => void;
  readonly setSearchQuery: (query: string) => void;
  readonly setShowLegacy: (showLegacy: boolean) => void;
  readonly replaceOpenRouterFilters: (filters: ReadonlySet<OpenRouterModelFilter>) => void;
  readonly toggleFavorite: (option: ModelOption) => void;
  readonly toggleOpenRouterFilter: (filter: OpenRouterModelFilter) => void;
  readonly toggleProvider: (providerKey: string) => void;
};

const ThreadSettingsSessionContext = createContext<ThreadSettingsSessionValue | null>(null);

/** Owns the staged model and option state for one picker presentation. */
function ThreadSettingsSessionProvider(
  props: ThreadSettingsSessionProps & { readonly children: ReactNode },
) {
  const [showLegacyToggle, setShowLegacyToggle] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openRouterFilters, replaceOpenRouterFilters] = useState<
    ReadonlySet<OpenRouterModelFilter>
  >(() => new Set(DEFAULT_OPENROUTER_MODEL_FILTERS));
  const [providerExpansionOverrides, setProviderExpansionOverrides] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingModel, setPendingModel] = useState<ModelOption | null>(null);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const modelFavorites = preferences.modelFavorites ?? [];
  const favoriteModelKeys = useMemo(
    () =>
      new Set(
        modelFavorites.map((favorite) => modelFavoriteKey(favorite.provider, favorite.model)),
      ),
    [modelFavorites],
  );

  const isApplied = useCallback(
    (option: ModelOption) =>
      option.selection.instanceId === props.selectedModel?.instanceId &&
      option.selection.model === props.selectedModel.model,
    [props.selectedModel],
  );
  // The list highlights the staged pick; Save turns it into the applied one.
  const isDisplayed = useCallback(
    (option: ModelOption) => (pendingModel ? option.key === pendingModel.key : isApplied(option)),
    [isApplied, pendingModel],
  );

  // While a model is staged, the settings rows describe and edit the staged
  // model's options (kept on its pending selection); Save applies model and
  // options together. Otherwise they edit the applied selection directly.
  const displayedDescriptors = useMemo(
    () =>
      pendingModel
        ? pendingModel.capabilities
          ? getProviderOptionDescriptors({
              caps: pendingModel.capabilities,
              selections: pendingModel.selection.options,
            })
          : []
        : props.optionDescriptors,
    [pendingModel, props.optionDescriptors],
  );
  const displayedSelection = pendingModel?.selection ?? props.selectedModel;
  const displayedModel =
    pendingModel ??
    props.providerGroups
      .flatMap((group) => group.models)
      .find(
        (model) =>
          model.selection.instanceId === displayedSelection?.instanceId &&
          model.selection.model === displayedSelection.model,
      ) ??
    null;
  const displayedProvider =
    displayedModel === null ? null : (displayedModel.providerDriver as ProviderDriverKind);
  const autoReasoningEnabled = isAutoReasoningEnabled(displayedSelection);

  const hasLegacyModels = useMemo(
    () => props.providerGroups.some((group) => group.models.some((model) => model.isLegacy)),
    [props.providerGroups],
  );
  const commitPendingModel = useCallback(() => {
    if (pendingModel) {
      void Haptics.selectionAsync();
      props.onSelectModel(pendingModel);
    }
  }, [pendingModel, props.onSelectModel]);

  const applyOptionChange = useCallback(
    (id: string, value: string | boolean) => {
      if (!displayedSelection) return;
      const next = applyThreadOptionChoice({
        selection: displayedSelection,
        descriptors: displayedDescriptors,
        id,
        value,
      });
      if (!next) return;
      if (pendingModel) {
        setPendingModel({
          ...pendingModel,
          selection: next,
        });
      } else {
        props.onUpdateOptionSelections(next.options ?? []);
      }
    },
    [displayedDescriptors, displayedSelection, pendingModel, props.onUpdateOptionSelections],
  );

  const toggleProvider = useCallback((providerKey: string) => {
    setProviderExpansionOverrides((current) => {
      const next = new Set(current);
      if (!next.delete(providerKey)) {
        next.add(providerKey);
      }
      return next;
    });
  }, []);

  const pressModel = useCallback(
    (option: ModelOption) => {
      if (!option.isSelectable) return;
      void Haptics.selectionAsync();
      setPendingModel((current) =>
        pendingModelAfterPress({
          current,
          pressed: option,
          pressedIsApplied: isApplied(option),
        }),
      );
    },
    [isApplied],
  );

  const isFavorite = useCallback(
    (option: ModelOption) =>
      favoriteModelKeys.has(modelFavoriteKey(option.selection.instanceId, option.selection.model)),
    [favoriteModelKeys],
  );

  const toggleFavorite = useCallback(
    (option: ModelOption) => {
      const provider = option.selection.instanceId;
      const model = option.selection.model;
      const index = modelFavorites.findIndex(
        (favorite) => favorite.provider === provider && favorite.model === model,
      );
      const next = [...modelFavorites];
      if (index >= 0) next.splice(index, 1);
      else next.push({ provider, model });
      void Haptics.selectionAsync();
      savePreferences({ modelFavorites: next });
    },
    [modelFavorites, savePreferences],
  );

  const toggleOpenRouterFilter = useCallback((filter: OpenRouterModelFilter) => {
    replaceOpenRouterFilters((current) => {
      const next = new Set(current);
      if (!next.delete(filter)) next.add(filter);
      return next;
    });
  }, []);

  const value = useMemo<ThreadSettingsSessionValue>(
    () => ({
      environmentId: props.environmentId,
      providerGroups: props.providerGroups,
      runtimeMode: props.runtimeMode,
      onUpdateRuntimeMode: props.onUpdateRuntimeMode,
      fetchSupported: props.fetchSupported === true,
      fetchEnabled: props.fetchEnabled === true,
      onUpdateFetchEnabled: props.onUpdateFetchEnabled,
      onCopyTranscript: props.onCopyTranscript,
      transcriptExportBusy: props.transcriptExportBusy === true,
      displayedDescriptors,
      displayedProvider,
      autoReasoningEnabled,
      autoReasoningStatus: props.autoReasoningStatus ?? null,
      providerExpansionOverrides,
      hasLegacyModels,
      pendingModel,
      providerFilter,
      searchQuery,
      showLegacy: showLegacyToggle,
      openRouterFilters,
      applyOptionChange,
      commitPendingModel,
      isApplied,
      isDisplayed,
      isFavorite,
      pressModel,
      setProviderFilter,
      setSearchQuery,
      setShowLegacy: setShowLegacyToggle,
      replaceOpenRouterFilters,
      toggleFavorite,
      toggleOpenRouterFilter,
      toggleProvider,
    }),
    [
      applyOptionChange,
      commitPendingModel,
      displayedDescriptors,
      displayedProvider,
      autoReasoningEnabled,
      providerExpansionOverrides,
      hasLegacyModels,
      isApplied,
      isDisplayed,
      isFavorite,
      openRouterFilters,
      props.environmentId,
      pendingModel,
      pressModel,
      providerFilter,
      props.onUpdateRuntimeMode,
      props.fetchSupported,
      props.fetchEnabled,
      props.onUpdateFetchEnabled,
      props.onCopyTranscript,
      props.transcriptExportBusy,
      props.autoReasoningStatus,
      props.providerGroups,
      props.runtimeMode,
      searchQuery,
      showLegacyToggle,
      toggleProvider,
      toggleFavorite,
      toggleOpenRouterFilter,
    ],
  );

  return (
    <ThreadSettingsSessionContext.Provider value={value}>
      {props.children}
    </ThreadSettingsSessionContext.Provider>
  );
}

function useThreadSettingsSession() {
  const value = use(ThreadSettingsSessionContext);
  if (!value) {
    throw new Error("useThreadSettingsSession must be used inside ThreadSettingsSessionProvider.");
  }
  return value;
}

type ThreadSettingsProviderCatalog = {
  readonly key: string;
  readonly driver: string | undefined;
  readonly label: string;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly opensCatalog: boolean;
  readonly modelCount: number;
  readonly models: ReadonlyArray<ModelOption>;
};

type ThreadSettingsCatalogItem =
  | {
      readonly kind: "provider";
      readonly key: string;
      readonly provider: ThreadSettingsProviderCatalog;
    }
  | {
      readonly kind: "model";
      readonly key: string;
      readonly option: ModelOption;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    }
  | {
      readonly kind: "empty";
      readonly key: "empty";
    }
  | {
      readonly kind: "options";
      readonly key: "options";
    };

function ThreadSettingsModelListRow(props: {
  readonly option: ModelOption;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const session = useThreadSettingsSession();
  const onPress = useCallback(
    () => session.pressModel(props.option),
    [props.option, session.pressModel],
  );
  const onToggleFavorite = useCallback(
    () => session.toggleFavorite(props.option),
    [props.option, session.toggleFavorite],
  );

  return (
    <ModelRow
      isFirst={props.isFirst}
      isLast={props.isLast}
      favorite={session.isFavorite(props.option)}
      onPress={onPress}
      onToggleFavorite={onToggleFavorite}
      option={props.option}
      selected={session.isDisplayed(props.option)}
    />
  );
}

function ThreadSettingsProviderListHeader(props: {
  readonly provider: ThreadSettingsProviderCatalog;
  readonly onOpenCatalog: (provider: ThreadSettingsProviderCatalog) => void;
}) {
  const session = useThreadSettingsSession();
  const onPress = useCallback(
    () =>
      props.provider.opensCatalog
        ? props.onOpenCatalog(props.provider)
        : session.toggleProvider(props.provider.key),
    [props.onOpenCatalog, props.provider, session.toggleProvider],
  );

  return (
    <ProviderHeader
      collapsible={props.provider.collapsible}
      collapsed={props.provider.collapsed}
      driver={props.provider.driver}
      label={props.provider.label}
      modelCount={props.provider.modelCount}
      opensCatalog={props.provider.opensCatalog}
      onPress={onPress}
    />
  );
}

function useThreadSettingsCatalogItems(
  session: ThreadSettingsSessionValue,
): ReadonlyArray<ThreadSettingsCatalogItem> {
  return useMemo(
    () =>
      session.providerGroups.flatMap((group) => {
        if (session.providerFilter !== null && group.providerKey !== session.providerFilter) {
          return [];
        }
        const driver = group.models[0]?.providerDriver;
        const catalogModels = session.showLegacy
          ? group.models
          : group.models.filter((model) => !model.isLegacy || session.isDisplayed(model));
        const visibleModels = catalogModels.filter((model) =>
          modelMatchesCatalogQuery({
            model,
            providerLabel: group.providerLabel,
            query: session.searchQuery,
          }),
        );
        if (visibleModels.length === 0) {
          return [];
        }
        const isPrimary = driver !== undefined && PRIMARY_PROVIDER_DRIVERS.has(driver);
        // Staging a model must not change disclosure state. The applied model
        // stays stable for the lifetime of this picker (Save closes it), so it
        // is safe to use as the initial selected-provider default.
        const containsAppliedSelection = group.models.some(session.isApplied);
        const opensCatalog = providerCatalogUsesDrillIn(driver);
        const isNarrowed = session.providerFilter !== null || session.searchQuery.trim().length > 0;
        const collapsible = !opensCatalog && !isNarrowed;
        const collapsed = opensCatalog
          ? true
          : providerSectionIsCollapsed({
              defaultExpanded: isPrimary || containsAppliedSelection,
              hasExpansionOverride: session.providerExpansionOverrides.has(group.providerKey),
              isNarrowed,
            });
        const provider: ThreadSettingsProviderCatalog = {
          key: group.providerKey,
          driver,
          label: group.providerLabel,
          collapsible,
          collapsed,
          opensCatalog,
          modelCount: visibleModels.length,
          models: collapsed ? [] : visibleModels,
        };
        return [
          {
            kind: "provider" as const,
            key: `provider:${group.providerKey}`,
            provider,
          },
          ...provider.models.map((option, index) => ({
            kind: "model" as const,
            key: `model:${option.key}`,
            option,
            isFirst: index === 0,
            isLast: index === provider.models.length - 1,
          })),
        ];
      }),
    [
      session.isApplied,
      session.isDisplayed,
      session.providerExpansionOverrides,
      session.providerFilter,
      session.providerGroups,
      session.searchQuery,
      session.showLegacy,
    ],
  );
}

function ThreadSettingsOptionsItem(props: {
  readonly animationsReady: boolean;
  readonly onOpenSubmenu: (submenu: ThreadSettingsSubmenuPage) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const bottomToolbarInset =
    Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
      ? NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET
      : 0;

  return (
    <View style={{ paddingBottom: insets.bottom + bottomToolbarInset + 12 }}>
      <Text className="px-5 pb-2 pt-2 text-sm font-t3-medium text-foreground-muted">
        {translator.message("mobile.thread.settings.options")}
      </Text>
      <Animated.View
        className="mx-4 overflow-hidden rounded-2xl bg-card"
        layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
      >
        {session.displayedDescriptors.map((descriptor) => {
          if (descriptor.type === "select") {
            return (
              <Animated.View
                key={descriptor.id}
                entering={
                  props.animationsReady ? THREAD_SETTINGS_OPTION_ENTER_TRANSITION : undefined
                }
                exiting={props.animationsReady ? THREAD_SETTINGS_OPTION_EXIT_TRANSITION : undefined}
                layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
              >
                <DisclosureRow
                  label={descriptor.label}
                  value={
                    descriptor.id === "reasoningEffort"
                      ? threadReasoningValueLabel({
                          autoReasoningEnabled: session.autoReasoningEnabled,
                          manualLabel: getProviderOptionCurrentLabel(descriptor) ?? "",
                          status: session.autoReasoningStatus,
                          autoLabel: translator.message("chat.traits.auto"),
                          fallbackLabel: translator.message("chat.traits.fallback"),
                        })
                      : getProviderOptionCurrentLabel(descriptor)
                  }
                  onPress={() => props.onOpenSubmenu({ kind: "descriptor", id: descriptor.id })}
                />
              </Animated.View>
            );
          }
          return (
            <Animated.View
              key={descriptor.id}
              entering={props.animationsReady ? THREAD_SETTINGS_OPTION_ENTER_TRANSITION : undefined}
              exiting={props.animationsReady ? THREAD_SETTINGS_OPTION_EXIT_TRANSITION : undefined}
              layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
            >
              <SwitchRow
                label={descriptor.label}
                value={descriptor.currentValue ?? false}
                onValueChange={(value) => session.applyOptionChange(descriptor.id, value)}
              />
            </Animated.View>
          );
        })}
        <Animated.View layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}>
          <DisclosureRow
            isLast={!session.fetchSupported}
            label={translator.message("mobile.thread.settings.runtime")}
            value={
              RUNTIME_MODE_CHOICES.find((choice) => choice.mode === session.runtimeMode)?.label
            }
            onPress={() => props.onOpenSubmenu({ kind: "runtime" })}
          />
        </Animated.View>
        {session.fetchSupported && session.onUpdateFetchEnabled ? (
          <Animated.View layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}>
            <SwitchRow
              isLast
              label={translator.message("mobile.thread.settings.fetchRepository")}
              value={session.fetchEnabled}
              onValueChange={session.onUpdateFetchEnabled}
            />
          </Animated.View>
        ) : null}
      </Animated.View>

      {session.onCopyTranscript ? (
        <>
          <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
            {translator.message("mobile.thread.settings.thread")}
          </Text>
          <View className="mx-4 overflow-hidden rounded-2xl bg-card">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                busy: session.transcriptExportBusy,
                disabled: session.transcriptExportBusy,
              }}
              className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-subtle disabled:opacity-40"
              disabled={session.transcriptExportBusy}
              onPress={() => void session.onCopyTranscript?.()}
            >
              {session.transcriptExportBusy ? (
                <ActivityIndicator size="small" />
              ) : (
                <SymbolView
                  name={{ ios: "doc.on.doc", android: "content_copy" }}
                  size={16}
                  type="monochrome"
                />
              )}
              <Text className="text-sm font-t3-medium text-foreground">
                {translator.message(
                  session.transcriptExportBusy
                    ? "mobile.thread.settings.copyingTranscript"
                    : "mobile.thread.settings.copyTranscript",
                )}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {Platform.OS !== "ios" && session.hasLegacyModels ? (
        <>
          <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
            {translator.message("mobile.thread.settings.catalog")}
          </Text>
          <View className="mx-4 overflow-hidden rounded-2xl bg-card">
            <SwitchRow
              isLast
              label={translator.message("mobile.thread.settings.legacyModels")}
              onValueChange={session.setShowLegacy}
              value={session.showLegacy}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

function CatalogFilterChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      className={cn(
        "min-h-11 shrink-0 items-center justify-center rounded-full border px-3 py-1.5",
        props.selected ? "border-foreground/20 bg-subtle-strong" : "border-border bg-card",
      )}
      onPress={props.onPress}
      style={{ minHeight: MOBILE_MODEL_FILTER_MIN_TOUCH_TARGET }}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          props.selected ? "text-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function OpenRouterCatalogFilterControls(props: {
  readonly favoritesOnly: boolean;
  readonly onToggleFavorites: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const session = useThreadSettingsSession();
  return (
    <ScrollView
      accessibilityLabel={translator.message("mobile.thread.settings.modelFilters")}
      horizontal
      bounces={false}
      contentContainerClassName="gap-2 px-4 pb-2"
      showsHorizontalScrollIndicator={false}
    >
      <CatalogFilterChip
        label={translator.message("mobile.thread.settings.favorites")}
        selected={props.favoritesOnly}
        onPress={props.onToggleFavorites}
      />
      <CatalogFilterChip
        label={translator.message("mobile.thread.settings.all")}
        selected={session.openRouterFilters.size === 0}
        onPress={() => session.replaceOpenRouterFilters(new Set())}
      />
      {OPENROUTER_FILTER_LABELS.map((filter) => (
        <CatalogFilterChip
          key={filter.id}
          label={translator.message(filter.messageKey)}
          selected={session.openRouterFilters.has(filter.id)}
          onPress={() => session.toggleOpenRouterFilter(filter.id)}
        />
      ))}
    </ScrollView>
  );
}

/** One native scroll owner for the model catalog and its related settings. */
function ThreadSettingsMainContent(props: {
  readonly onOpenSubmenu: (submenu: ThreadSettingsSubmenuPage) => void;
  readonly onOpenProviderCatalog: (provider: ThreadSettingsProviderCatalog) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const session = useThreadSettingsSession();
  const catalogItems = useThreadSettingsCatalogItems(session);
  const [animationsReady, setAnimationsReady] = useState(false);
  const nativeHeaderHeight = use(HeaderHeightContext) ?? 0;
  const hasActiveCatalogFilter =
    session.providerFilter !== null || session.searchQuery.trim().length > 0;
  const usesTransparentNativeHeader = Platform.OS === "ios" && NATIVE_LIQUID_GLASS_SUPPORTED;
  const listItems = useMemo<ReadonlyArray<ThreadSettingsCatalogItem>>(
    () => [
      ...(catalogItems.length === 0 && hasActiveCatalogFilter
        ? ([{ kind: "empty", key: "empty" }] as const)
        : catalogItems),
      { kind: "options", key: "options" },
    ],
    [catalogItems, hasActiveCatalogFilter],
  );
  const renderCatalogItem = useCallback(
    (itemProps: LegendListRenderItemProps<ThreadSettingsCatalogItem>) => {
      const item = itemProps.item;
      let content: ReactNode;

      if (item.kind === "provider") {
        content = (
          <ThreadSettingsProviderListHeader
            onOpenCatalog={props.onOpenProviderCatalog}
            provider={item.provider}
          />
        );
      } else if (item.kind === "model") {
        content = (
          <ThreadSettingsModelListRow
            isFirst={item.isFirst}
            isLast={item.isLast}
            option={item.option}
          />
        );
      } else if (item.kind === "empty") {
        content = (
          <View className="items-center px-8 py-14">
            <Text className="text-center text-sm text-foreground-muted">
              {translator.message("mobile.thread.settings.noMatchingModels")}
            </Text>
          </View>
        );
      } else {
        content = (
          <ThreadSettingsOptionsItem
            animationsReady={animationsReady}
            onOpenSubmenu={props.onOpenSubmenu}
          />
        );
      }

      return (
        <Animated.View
          key={item.key}
          entering={animationsReady ? THREAD_SETTINGS_CATALOG_ENTER_TRANSITION : undefined}
          exiting={animationsReady ? THREAD_SETTINGS_CATALOG_EXIT_TRANSITION : undefined}
        >
          {content}
        </Animated.View>
      );
    },
    [animationsReady, props.onOpenProviderCatalog, props.onOpenSubmenu, translator],
  );

  return (
    <AnimatedLegendList
      automaticallyAdjustsScrollIndicatorInsets
      className="flex-1 bg-sheet"
      contentContainerStyle={{ paddingTop: 4 }}
      contentInsetAdjustmentBehavior={usesTransparentNativeHeader ? "never" : "automatic"}
      data={listItems}
      estimatedItemSize={48}
      extraData={animationsReady}
      getItemType={(item) => item.kind}
      itemLayoutAnimation={THREAD_SETTINGS_CATALOG_LAYOUT_TRANSITION}
      keyExtractor={(item) => item.key}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION}
      ListHeaderComponent={
        <>
          {usesTransparentNativeHeader ? <View style={{ height: nativeHeaderHeight }} /> : null}
          {Platform.OS === "android" ? (
            <View className="px-4 pb-2 pt-3">
              <TextInput
                accessibilityLabel={translator.message("mobile.thread.settings.findModel")}
                autoCapitalize="none"
                autoCorrect={false}
                className="h-11 rounded-xl bg-card px-4 text-base text-foreground"
                onChangeText={session.setSearchQuery}
                placeholder={translator.message("mobile.thread.settings.findModel")}
                placeholderTextColorClassName="accent-placeholder"
                value={session.searchQuery}
              />
            </View>
          ) : null}
        </>
      }
      recycleItems
      onLoad={() => setAnimationsReady(true)}
      renderItem={renderCatalogItem}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Compact choice page pushed by the picker navigator. */
function ThreadSettingsChoiceContent(props: {
  readonly submenu: ThreadSettingsSubmenuPage;
  readonly onSelected: () => void;
}) {
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const descriptorId = props.submenu.kind === "descriptor" ? props.submenu.id : null;

  const activeDescriptor =
    descriptorId !== null
      ? session.displayedDescriptors.find(
          (descriptor) => descriptor.type === "select" && descriptor.id === descriptorId,
        )
      : undefined;

  const submenuContent =
    props.submenu.kind === "runtime"
      ? {
          rows: RUNTIME_MODE_CHOICES.map((choice) => ({
            id: choice.mode,
            label: choice.label,
            description: choice.description,
            selected: choice.mode === session.runtimeMode,
            onPress: () => {
              void Haptics.selectionAsync();
              session.onUpdateRuntimeMode(choice.mode);
              props.onSelected();
            },
          })),
        }
      : activeDescriptor?.type === "select"
        ? {
            rows: threadReasoningChoices(session.displayedProvider, activeDescriptor).map(
              (choice) => ({
                id: choice.id,
                label: choice.label,
                description: "description" in choice ? choice.description : undefined,
                selected:
                  choice.id === "t3AutoReasoning"
                    ? session.autoReasoningEnabled
                    : !session.autoReasoningEnabled &&
                      choice.id === getProviderOptionCurrentValue(activeDescriptor),
                onPress: () => {
                  void Haptics.selectionAsync();
                  session.applyOptionChange(activeDescriptor.id, choice.id);
                  props.onSelected();
                },
              }),
            ),
          }
        : null;

  if (!submenuContent) {
    return <View className="flex-1 bg-sheet" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{
        paddingBottom: insets.bottom + 12,
        paddingHorizontal: 16,
        paddingTop: 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View className="overflow-hidden rounded-2xl bg-card">
        {submenuContent.rows.map((row, index) => (
          <ChoiceRow
            key={row.id}
            description={row.description}
            isLast={index === submenuContent.rows.length - 1}
            label={row.label}
            selected={row.selected}
            onPress={row.onPress}
          />
        ))}
      </View>
    </ScrollView>
  );
}

type ThreadSettingsPickerStackParams = {
  ThreadSettingsModels: undefined;
  ThreadSettingsProviderCatalog: {
    readonly providerKey: string;
    readonly title: string;
  };
  ThreadSettingsChoice: ThreadSettingsSubmenuPage & { readonly title: string };
};

type ThreadSettingsPickerPresentation = {
  readonly onClose: () => void;
};

const ThreadSettingsPickerStack = createNativeStackNavigator<ThreadSettingsPickerStackParams>();
const ThreadSettingsPickerPresentationContext =
  createContext<ThreadSettingsPickerPresentation | null>(null);

function useThreadSettingsPickerPresentation() {
  const value = use(ThreadSettingsPickerPresentationContext);
  if (!value) {
    throw new Error(
      "useThreadSettingsPickerPresentation must be used inside ThreadSettingsPickerNavigator.",
    );
  }
  return value;
}

function ThreadSettingsModelsScreen() {
  const translator = useMobileInterfaceTranslator();
  const session = useThreadSettingsSession();
  const presentation = useThreadSettingsPickerPresentation();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const usesNativeMailSearchToolbar = Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED;
  const hasCustomCatalogFilter = session.providerFilter !== null || session.showLegacy;
  const refreshProvidersCommand = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshProviderCatalog = useMemo(
    () => createProviderCatalogRefreshRunner(refreshProvidersCommand),
    [refreshProvidersCommand],
  );
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshProviders = useCallback(() => {
    if (!session.environmentId || isRefreshingProviders) return;
    setIsRefreshingProviders(true);
    void refreshProviderCatalog(session.environmentId).then((result) => {
      setIsRefreshingProviders(false);
      const error = providerCatalogRefreshError(result);
      if (error) Alert.alert(translator.message("mobile.thread.settings.refreshFailed"), error);
    });
  }, [isRefreshingProviders, refreshProviderCatalog, session.environmentId]);
  const commitAndClose = useCallback(() => {
    session.commitPendingModel();
    presentation.onClose();
  }, [presentation, session]);
  const filterMenu = useMemo(
    () => ({
      title: translator.message("mobile.thread.settings.modelFilters"),
      items: [
        {
          type: "submenu" as const,
          title: translator.message("mobile.thread.settings.provider"),
          items: [
            {
              type: "action" as const,
              title: translator.message("mobile.thread.settings.allProviders"),
              state: session.providerFilter === null ? ("on" as const) : ("off" as const),
              onPress: () => session.setProviderFilter(null),
            },
            ...session.providerGroups.map((group) => ({
              type: "action" as const,
              title: group.providerLabel,
              state:
                session.providerFilter === group.providerKey ? ("on" as const) : ("off" as const),
              onPress: () => session.setProviderFilter(group.providerKey),
            })),
          ],
        },
        ...(session.hasLegacyModels
          ? [
              {
                type: "action" as const,
                title: translator.message("mobile.thread.settings.showLegacyModels"),
                state: session.showLegacy ? ("on" as const) : ("off" as const),
                onPress: () => session.setShowLegacy(!session.showLegacy),
              },
            ]
          : []),
      ],
    }),
    [session, translator],
  );

  return (
    <>
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          actions={[
            {
              accessibilityLabel: translator.message("mobile.thread.settings.refreshModels"),
              disabled: isRefreshingProviders || session.environmentId === null,
              icon: "arrow.clockwise",
              onPress: refreshProviders,
            },
            {
              accessibilityLabel: translator.message(
                session.pendingModel
                  ? "mobile.thread.settings.saveA11y"
                  : "mobile.thread.settings.done",
              ),
              icon: "checkmark",
              onPress: commitAndClose,
            },
          ]}
          onBack={presentation.onClose}
          title={translator.message("mobile.thread.settings.title")}
        />
      ) : null}
      <NativeStackScreenOptions
        optionsVersion={[
          session.providerFilter,
          session.providerGroups.map((group) => group.providerKey),
          session.showLegacy,
        ]}
        options={{
          unstable_headerToolbarItems: usesNativeMailSearchToolbar
            ? () => [
                createNativeMailSearchToolbarItem({
                  filterButtonId: "thread-settings-model-filter",
                  filterMenu,
                  filterSystemImageName: hasCustomCatalogFilter
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease",
                  onSearchTextChange: session.setSearchQuery,
                  placeholder: translator.message("mobile.thread.settings.findModel"),
                  searchTextChangeId: "thread-settings-model-search-text",
                  showsSearchDismissButton: true,
                }),
              ]
            : undefined,
          headerShown: Platform.OS !== "android",
          headerSearchBarOptions:
            Platform.OS === "ios" && !usesNativeMailSearchToolbar
              ? {
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  obscureBackground: false,
                  onCancelButtonPress: () => session.setSearchQuery(""),
                  onChangeText: (event) => session.setSearchQuery(event.nativeEvent.text),
                  placeholder: translator.message("mobile.thread.settings.findModel"),
                }
              : undefined,
        }}
      />
      <ThreadSettingsMainContent
        onOpenProviderCatalog={(provider) =>
          navigation.navigate("ThreadSettingsProviderCatalog", {
            providerKey: provider.key,
            title: provider.label,
          })
        }
        onOpenSubmenu={(submenu) => {
          const title =
            submenu.kind === "runtime"
              ? translator.message("mobile.thread.settings.runtime")
              : (session.displayedDescriptors.find(
                  (descriptor) => descriptor.type === "select" && descriptor.id === submenu.id,
                )?.label ?? translator.message("mobile.thread.settings.options"));
          navigation.navigate("ThreadSettingsChoice", { ...submenu, title });
        }}
      />
      <NativeHeaderToolbar placement="left">
        <NativeHeaderToolbar.Button
          accessibilityLabel={translator.message("mobile.thread.settings.cancelA11y")}
          label={translator.message("common.cancel")}
          onPress={presentation.onClose}
        />
      </NativeHeaderToolbar>
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel={translator.message("mobile.thread.settings.refreshModels")}
          disabled={isRefreshingProviders || session.environmentId === null}
          icon="arrow.clockwise"
          onPress={refreshProviders}
          separateBackground
        />
        <NativeHeaderToolbar.Button
          accessibilityLabel={translator.message(
            session.pendingModel
              ? "mobile.thread.settings.saveA11y"
              : "mobile.thread.settings.done",
          )}
          label={translator.message(
            session.pendingModel ? "mobile.thread.settings.save" : "mobile.thread.settings.done",
          )}
          onPress={commitAndClose}
        />
      </NativeHeaderToolbar>
      {Platform.OS === "ios" && !usesNativeMailSearchToolbar ? (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel={translator.message("mobile.thread.settings.filterModels")}
            icon={
              hasCustomCatalogFilter
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            separateBackground
            title={translator.message("mobile.thread.settings.modelFilters")}
          >
            <NativeHeaderToolbar.Menu title={translator.message("mobile.thread.settings.provider")}>
              <NativeHeaderToolbar.Label>
                {translator.message("mobile.thread.settings.provider")}
              </NativeHeaderToolbar.Label>
              <NativeHeaderToolbar.MenuAction
                isOn={session.providerFilter === null}
                onPress={() => session.setProviderFilter(null)}
              >
                {translator.message("mobile.thread.settings.allProviders")}
              </NativeHeaderToolbar.MenuAction>
              {session.providerGroups.map((group) => (
                <NativeHeaderToolbar.MenuAction
                  key={group.providerKey}
                  isOn={session.providerFilter === group.providerKey}
                  onPress={() => session.setProviderFilter(group.providerKey)}
                >
                  {group.providerLabel}
                </NativeHeaderToolbar.MenuAction>
              ))}
            </NativeHeaderToolbar.Menu>
            {session.hasLegacyModels ? (
              <NativeHeaderToolbar.MenuAction
                isOn={session.showLegacy}
                onPress={() => session.setShowLegacy(!session.showLegacy)}
              >
                {translator.message("mobile.thread.settings.showLegacyModels")}
              </NativeHeaderToolbar.MenuAction>
            ) : null}
          </NativeHeaderToolbar.Menu>
        </NativeHeaderToolbar>
      ) : null}
    </>
  );
}

function OpenRouterCatalogModelRow(props: {
  readonly option: ModelOption;
  readonly index: number;
  readonly count: number;
  readonly onSelected: () => void;
}) {
  const session = useThreadSettingsSession();
  const onPress = useCallback(() => {
    session.pressModel(props.option);
    props.onSelected();
  }, [props.onSelected, props.option, session.pressModel]);
  const onToggleFavorite = useCallback(
    () => session.toggleFavorite(props.option),
    [props.option, session.toggleFavorite],
  );

  return (
    <ModelRow
      favorite={session.isFavorite(props.option)}
      isFirst={props.index === 0}
      isLast={props.index === props.count - 1}
      onPress={onPress}
      onToggleFavorite={onToggleFavorite}
      option={props.option}
      selected={session.isDisplayed(props.option)}
    />
  );
}

/** OpenRouter's full remote catalog stays inside the picker on a focused page. */
function ThreadSettingsProviderCatalogScreen() {
  const translator = useMobileInterfaceTranslator();
  const session = useThreadSettingsSession();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const route =
    useRoute<RouteProp<ThreadSettingsPickerStackParams, "ThreadSettingsProviderCatalog">>();
  const insets = useSafeAreaInsets();
  const nativeHeaderHeight = use(HeaderHeightContext) ?? 0;
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const providerGroup = session.providerGroups.find(
    (group) => group.providerKey === route.params.providerKey,
  );
  const usesNativeMailSearchToolbar = Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED;
  const usesTransparentNativeHeader = Platform.OS === "ios" && NATIVE_LIQUID_GLASS_SUPPORTED;
  const filteredModels = useMemo(
    () =>
      providerGroup
        ? filterOpenRouterProviderCatalog({
            models: providerGroup.models,
            providerLabel: providerGroup.providerLabel,
            query,
            filters: session.openRouterFilters,
            favoritesOnly,
            isFavorite: session.isFavorite,
          })
        : [],
    [favoritesOnly, providerGroup, query, session.isFavorite, session.openRouterFilters],
  );
  const listExtraData = useMemo(
    () => ({
      favoriteResolver: session.isFavorite,
      pendingModelKey: session.pendingModel?.key ?? null,
    }),
    [session.isFavorite, session.pendingModel?.key],
  );
  const onSelected = useCallback(() => navigation.goBack(), [navigation]);
  const renderModel = useCallback(
    (itemProps: LegendListRenderItemProps<ModelOption>) => (
      <OpenRouterCatalogModelRow
        count={filteredModels.length}
        index={itemProps.index}
        onSelected={onSelected}
        option={itemProps.item}
      />
    ),
    [filteredModels.length, onSelected],
  );
  const toggleFavorites = useCallback(() => setFavoritesOnly((current) => !current), []);

  useEffect(() => {
    if (!providerGroup) {
      navigation.goBack();
    }
  }, [navigation, providerGroup]);

  const totalModels = providerGroup?.models.length ?? 0;
  const providerDriver = providerGroup?.models[0]?.providerDriver;
  const bottomToolbarInset = usesNativeMailSearchToolbar
    ? NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET
    : 0;

  return (
    <>
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
      ) : null}
      <NativeStackScreenOptions
        optionsVersion={[route.params.providerKey]}
        options={{
          headerShown: Platform.OS !== "android",
          unstable_headerToolbarItems: usesNativeMailSearchToolbar
            ? () => [
                createNativeMailSearchToolbarItem({
                  onSearchTextChange: setQuery,
                  placeholder: translator.message("mobile.thread.settings.searchOpenRouter"),
                  searchTextChangeId: "openrouter-model-search-text",
                  showsSearchDismissButton: true,
                }),
              ]
            : undefined,
          headerSearchBarOptions:
            Platform.OS === "ios" && !usesNativeMailSearchToolbar
              ? {
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  obscureBackground: false,
                  onCancelButtonPress: () => setQuery(""),
                  onChangeText: (event) => setQuery(event.nativeEvent.text),
                  placeholder: translator.message("mobile.thread.settings.searchOpenRouter"),
                }
              : undefined,
        }}
      />
      <AnimatedLegendList
        automaticallyAdjustsScrollIndicatorInsets
        className="flex-1 bg-sheet"
        contentContainerStyle={{
          paddingBottom: insets.bottom + bottomToolbarInset + 12,
          paddingTop: 4,
        }}
        contentInsetAdjustmentBehavior={usesTransparentNativeHeader ? "never" : "automatic"}
        data={filteredModels}
        drawDistance={480}
        estimatedItemSize={52}
        extraData={listExtraData}
        keyExtractor={(option) => option.key}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION}
        recycleItems
        renderItem={renderModel}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {usesTransparentNativeHeader ? <View style={{ height: nativeHeaderHeight }} /> : null}
            {Platform.OS === "android" ? (
              <View className="px-4 pb-2 pt-3">
                <TextInput
                  accessibilityLabel={translator.message("mobile.thread.settings.searchOpenRouter")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-11 rounded-xl bg-card px-4 text-base text-foreground"
                  onChangeText={setQuery}
                  placeholder={translator.message("mobile.thread.settings.searchOpenRouter")}
                  placeholderTextColorClassName="accent-placeholder"
                  value={query}
                />
              </View>
            ) : null}
            <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3">
              <View className="size-10 items-center justify-center rounded-xl bg-subtle">
                <ProviderIcon provider={providerDriver} size={24} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-base font-t3-semibold text-foreground" numberOfLines={1}>
                  {providerGroup?.providerLabel ?? route.params.title}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {translator.message("mobile.thread.settings.modelCount", {
                    visible: filteredModels.length,
                    total: totalModels,
                  })}
                </Text>
              </View>
            </View>
            <OpenRouterCatalogFilterControls
              favoritesOnly={favoritesOnly}
              onToggleFavorites={toggleFavorites}
            />
          </>
        }
        ListEmptyComponent={
          <View className="items-center px-8 py-14">
            <Text className="text-center text-sm text-foreground-muted">
              {translator.message("mobile.thread.settings.noMatchingModels")}
            </Text>
          </View>
        }
      />
    </>
  );
}

function ThreadSettingsChoiceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const route = useRoute<RouteProp<ThreadSettingsPickerStackParams, "ThreadSettingsChoice">>();

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: Platform.OS !== "android" }} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
      ) : null}
      <ThreadSettingsChoiceContent submenu={route.params} onSelected={() => navigation.goBack()} />
    </>
  );
}

function ThreadSettingsPickerNavigator(props: ThreadSettingsPickerPresentation) {
  const translator = useMobileInterfaceTranslator();
  const theme = useUniwindTheme();
  const solidSheetBackground = theme["--color-sheet-solid"];
  const foreground = theme["--color-foreground"];
  const presentation = useMemo(
    () => ({
      onClose: props.onClose,
    }),
    [props.onClose],
  );

  return (
    <ThreadSettingsPickerPresentationContext.Provider value={presentation}>
      <ThreadSettingsPickerStack.Navigator
        initialRouteName="ThreadSettingsModels"
        screenOptions={{
          animation: "slide_from_right",
          contentStyle: { backgroundColor: solidSheetBackground },
          gestureEnabled: true,
          headerBackButtonDisplayMode: "minimal",
          headerBackTitle: "",
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: NATIVE_LIQUID_GLASS_SUPPORTED ? "transparent" : solidSheetBackground,
          },
          headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
          headerTintColor: foreground,
          headerTitleStyle: { fontSize: 17, fontWeight: "700" },
          scrollEdgeEffects: NATIVE_LIQUID_GLASS_SUPPORTED
            ? THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS
            : undefined,
        }}
      >
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsModels"
          component={ThreadSettingsModelsScreen}
          options={{
            headerBackVisible: false,
            title: translator.message("mobile.thread.settings.title"),
          }}
        />
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsProviderCatalog"
          component={ThreadSettingsProviderCatalogScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsChoice"
          component={ThreadSettingsChoiceScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
      </ThreadSettingsPickerStack.Navigator>
    </ThreadSettingsPickerPresentationContext.Provider>
  );
}

/** Existing-thread model picker hosted by the root RNS form-sheet route. */
export function ExistingThreadSettingsRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const presentation = useExistingThreadSettingsRoutePresentation();
  const session = presentation.session;

  useEffect(() => {
    if (session) {
      return;
    }

    navigation.goBack();
  }, [navigation, session]);

  if (!session) {
    return <View className="flex-1 bg-sheet" />;
  }

  const { ownerId: _ownerId, ...settings } = session;

  return (
    <ThreadSettingsSessionProvider {...settings}>
      <ThreadSettingsPickerNavigator onClose={() => navigation.goBack()} />
    </ThreadSettingsSessionProvider>
  );
}

/**
 * Native stack hosted by the New Task navigator's form-sheet route. Keeping
 * the sheet presentation in RNS gives UIKit ownership of nested dismissal,
 * while Reasoning and Runtime remain regular pushes inside this navigator.
 */
export function NewTaskThreadSettingsRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const serverConfig = useEnvironmentServerConfig(flow.selectedProject?.environmentId ?? null);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const effectiveExperimentalFetch = flow.editingPendingTask
    ? flow.fetchMode === "repository-exploration"
    : preferences.experimentalFetch;
  const workflowSettings = useMemo(
    () =>
      resolveMobileAgentWorkflowSettings({
        agentWorkflowVersion: serverConfig?.environment.capabilities.agentWorkflowVersion,
        experimentalFetch: effectiveExperimentalFetch,
      }),
    [effectiveExperimentalFetch, serverConfig?.environment.capabilities.agentWorkflowVersion],
  );
  const updateFetchEnabled = useCallback(
    (enabled: boolean) => {
      if (flow.editingPendingTask) {
        flow.setFetchMode(enabled ? "repository-exploration" : undefined);
        return;
      }
      savePreferences({ experimentalFetch: enabled });
    },
    [flow.editingPendingTask, flow.setFetchMode, savePreferences],
  );
  const optionDescriptors = useMemo(
    () =>
      resolveProviderOptionDescriptors({
        capabilities: flow.selectedModelOption?.capabilities,
        selections: flow.selectedModel?.options,
      }),
    [flow.selectedModel?.options, flow.selectedModelOption?.capabilities],
  );

  return (
    <ThreadSettingsSessionProvider
      environmentId={flow.selectedEnvironmentId}
      providerGroups={flow.providerGroups}
      selectedModel={flow.selectedModel}
      onSelectModel={(option) => flow.setSelectedModelKey(option.key, option.selection.options)}
      optionDescriptors={optionDescriptors}
      onUpdateOptionSelections={flow.setSelectedModelOptions}
      runtimeMode={flow.runtimeMode}
      onUpdateRuntimeMode={flow.setRuntimeMode}
      fetchSupported={workflowSettings.supported}
      fetchEnabled={workflowSettings.fetchEnabled}
      onUpdateFetchEnabled={updateFetchEnabled}
    >
      <ThreadSettingsPickerNavigator onClose={() => navigation.goBack()} />
    </ThreadSettingsSessionProvider>
  );
}
