import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  clampManagedRuntimeMode,
  managedCapabilityDenial,
  resolveProjectProviderInstanceEnabled,
} from "@t3tools/contracts";
import { readEnvironmentScope } from "../../state/session";
import type {
  EnvironmentId,
  ProjectId,
  ScheduledTask,
  ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import {
  MAX_WEBHOOK_DELIVERY_AGE_MINUTES,
  MAX_WEBHOOK_FILTERS,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { resolvePastedPath } from "@t3tools/shared/path";
import {
  DEFAULT_WEBHOOK_PROMPT,
  emptyWebhookFilterDraft,
  parseMaxDeliveryAge,
  parseWebhookFilterDrafts,
  removeWebhookFilterDraft,
  WEBHOOK_FILTER_OPS,
  type WebhookFilterDraft,
} from "@t3tools/client-runtime/scheduled-task-webhook";
import { useRef, useState, type ReactNode } from "react";
import { useFocusEffect, useNavigation, usePreventRemove } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AppState, Platform, Pressable, TextInput as RNTextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import {
  EnvironmentMachineSymbol,
  ENVIRONMENT_MACHINE_SYMBOLS,
} from "../../components/EnvironmentMachineSymbol";
import { Menu } from "../../components/ui/Menu";
import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { usePreparedConnection } from "../../state/session";
import { buildModelOptions } from "../../lib/modelOptions";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects, useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { resolveNewTaskBranchLabel } from "../threads/new-task-context-presentation";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { ScheduledTaskPromptField } from "./components/ScheduledTaskPromptField";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import {
  editDraft,
  parseIntervalMinutes,
  scheduledTaskDefaultModel,
  scheduleFromDraft,
  type ScheduledTaskDraft as Draft,
} from "./scheduledTaskDraft";
import { settingsTargetsForProject } from "./settings-environment-filter.logic";
import { useScheduledTaskEditor } from "./scheduled-task-editor";
import {
  discardScheduledTaskEditor,
  markScheduledTaskEditorSaved,
  scheduledTaskEditorSessionAtom,
} from "./scheduled-task-editor-state";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  formatNextScheduledTaskRun,
  formatScheduledTaskInterval,
} from "./scheduledTaskPresentation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ProjectSettingsSelect } from "./ProjectSettingsFields";
import { WebhookSignatureSettings, WebhookDeliveriesSettings } from "./WebhookTaskSettings";
import { useThreadShells } from "../../state/entities";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

type ScheduledTaskRoutes = {
  SettingsScheduledTaskNew: undefined;
  SettingsScheduledTaskEdit: undefined;
  SettingsScheduledTaskModel: undefined;
  SettingsScheduledTaskBranch: undefined;
};

const DAYS = [
  {
    index: 1,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.mon");
    },
  },
  {
    index: 2,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.tue");
    },
  },
  {
    index: 3,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.wed");
    },
  },
  {
    index: 4,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.thu");
    },
  },
  {
    index: 5,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.fri");
    },
  },
  {
    index: 6,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.sat");
    },
  },
  {
    index: 0,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.sun");
    },
  },
] as const;

function describeSchedule(task: ScheduledTask): string {
  if (task.schedule.type === "webhook") return "On webhook";
  if (task.schedule.type === "once") {
    const runAt = new Date(task.schedule.runAt);
    return `Once, ${formatRunAtDate(runAt)} at ${formatRunAtTime(runAt)}`;
  }
  if (task.schedule.type === "interval") return formatScheduledTaskInterval(task.schedule.everyMs);
  const days = task.schedule.weekdays?.length
    ? repeatLabel(task.schedule.weekdays)
    : currentInterfaceTranslator().message("mobile.ui.everyDay");
  return `${days} at ${formatTime(task.schedule.timeOfDay)}`;
}

function formatTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value;
  const time = new Date();
  time.setHours(hours ?? 9, minutes ?? 0, 0, 0);
  return time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRunAtDate(value: Date): string {
  return value.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatRunAtTime(value: Date): string {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timePickerValue(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  const time = new Date();
  time.setHours(
    Number.isInteger(hours) ? (hours ?? 9) : 9,
    Number.isInteger(minutes) ? (minutes ?? 0) : 0,
    0,
    0,
  );
  return time;
}

function repeatLabel(weekdays: ReadonlyArray<number>): string {
  const days = new Set(weekdays);
  if (days.size === 7) return "Every day";
  if (days.size === 5 && [1, 2, 3, 4, 5].every((day) => days.has(day))) return "Weekdays";
  return (
    DAYS.filter((day) => days.has(day.index))
      .map((day) => day.label)
      .join(", ") || "Choose days"
  );
}

function FormField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly keyboardType?: "decimal-pad" | "number-pad";
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly borderTop?: boolean;
}) {
  return (
    <View
      className={
        props.borderTop ? "gap-2 border-t border-border-subtle px-4 py-3" : "gap-2 px-4 py-3"
      }
    >
      <Text className="text-sm text-foreground-muted">{props.label}</Text>
      <RNTextInput
        accessibilityLabel={props.label}
        value={props.value}
        readOnly={props.disabled}
        onChangeText={props.onChange}
        textAlignVertical="center"
        keyboardType={props.keyboardType}
        placeholder={props.placeholder}
        placeholderTextColorClassName="accent-foreground-muted"
        className="min-h-8 font-sans text-base text-foreground"
      />
    </View>
  );
}

function SelectRow(props: {
  readonly label: string;
  readonly value: string;
  readonly valueIcon?: ReactNode;
  readonly actions: MenuAction[];
  readonly onSelect: (id: string) => void;
  readonly borderTop?: boolean;
}) {
  const value = (
    <View className="min-w-0 flex-1 flex-row items-center justify-end gap-2">
      {props.valueIcon}
      <Text
        textRole="footnote"
        className="shrink text-right text-foreground-muted"
        numberOfLines={1}
      >
        {props.value}
      </Text>
    </View>
  );
  if (props.actions.length === 0) {
    return (
      <View
        className={
          props.borderTop
            ? "min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
            : "min-h-14 flex-row items-center gap-3 px-4 py-3"
        }
      >
        <Text textRole="body" className="text-foreground">
          {props.label}
        </Text>
        {value}
      </View>
    );
  }
  return (
    <Menu
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${props.value}`}
        className={
          props.borderTop
            ? "min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
            : "min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
        }
      >
        <Text textRole="body" className="text-foreground">
          {props.label}
        </Text>
        {value}
        <SymbolView
          name="chevron.down"
          size={14}
          tintColorClassName="accent-chevron"
          type="monochrome"
        />
      </Pressable>
    </Menu>
  );
}

function WebhookFilterRows(props: {
  readonly filters: ReadonlyArray<WebhookFilterDraft>;
  readonly disabled: boolean;
  readonly onChange: (filters: ReadonlyArray<WebhookFilterDraft>) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const update = (index: number, patch: Partial<WebhookFilterDraft>) =>
    props.onChange(
      props.filters.map((filter, at) => (at === index ? { ...filter, ...patch } : filter)),
    );
  return (
    <>
      {props.filters.map((filter, index) => (
        <View key={filter.id}>
          <View className="flex-row items-center gap-3 border-t border-border-subtle px-4 pt-3">
            <Text className="min-w-0 flex-1 text-sm text-foreground-muted">Filter {index + 1}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${index + 1}`}
              disabled={props.disabled}
              hitSlop={8}
              onPress={() => props.onChange(removeWebhookFilterDraft(props.filters, filter.id))}
              className="active:opacity-70"
            >
              <SymbolView name="trash" size={16} tintColorClassName="accent-danger-foreground" />
            </Pressable>
          </View>
          <FormField
            label={translator.message("sidebar.thread.menu.path")}
            value={filter.path}
            placeholder="body.action"
            disabled={props.disabled}
            onChange={(path) => update(index, { path })}
          />
          <SelectRow
            label={translator.message("browser.script.exampleName")}
            value={WEBHOOK_FILTER_OPS.find((option) => option.op === filter.op)?.label ?? ""}
            actions={WEBHOOK_FILTER_OPS.map((option) => ({
              id: option.op,
              title: option.label,
              state: option.op === filter.op ? ("on" as const) : undefined,
            }))}
            onSelect={(id) => {
              const known = WEBHOOK_FILTER_OPS.find((option) => option.op === id);
              if (known) update(index, { op: known.op });
            }}
          />
          {filter.op === "exists" ? null : (
            <FormField
              label={
                filter.op === "in"
                  ? translator.message("mobile.ui.valuesCommaSeparated")
                  : translator.message("settings.mcp.editor.value")
              }
              value={filter.value}
              placeholder={filter.op === "in" ? "opened, reopened" : "opened"}
              disabled={props.disabled}
              onChange={(value) => update(index, { value })}
            />
          )}
        </View>
      ))}
      {props.filters.length < MAX_WEBHOOK_FILTERS ? (
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          onPress={() => props.onChange([...props.filters, emptyWebhookFilterDraft()])}
          className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
        >
          <Text textRole="body" className="min-w-0 flex-1 text-foreground">
            {translator.message("mobile.ui.addFilter")}
          </Text>
          <SymbolView name="plus" size={16} tintColorClassName="accent-icon" />
        </Pressable>
      ) : null}
      {props.filters.length > 0 ? (
        <Text className="px-4 pb-3 text-sm text-foreground-muted">
          {translator.message("mobile.ui.runsOnlyWhenEveryFilterMatchesOther")}
        </Text>
      ) : null}
    </>
  );
}

function PickerRow(props: {
  readonly label: string;
  readonly value: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly borderTop?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}, ${props.value}`}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={
        props.borderTop
          ? "min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70 disabled:opacity-50"
          : "min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70 disabled:opacity-50"
      }
    >
      <Text textRole="body" className="text-foreground">
        {props.label}
      </Text>
      <Text
        textRole="footnote"
        className="min-w-0 flex-1 text-right text-foreground-muted"
        numberOfLines={1}
      >
        {props.value}
      </Text>
      <SymbolView
        name="chevron.right"
        size={14}
        tintColorClassName="accent-chevron"
        type="monochrome"
      />
    </Pressable>
  );
}

export function SettingsScheduledTasksRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = setInterval(updateNow, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") updateNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  });
  const { availableTargets, selectedTargets, selectedProjectKey, projectGroups } =
    useSettingsEnvironmentFilter();
  const selectedGroup = projectGroups.find((group) => group.key === selectedProjectKey);
  const visibleEnvironments = settingsTargetsForProject(
    selectedTargets,
    selectedProjectKey === null ? null : selectedGroup,
  );
  const { startEditor, resetEditor } = useScheduledTaskEditor();
  const navigation = useNavigation<NativeStackNavigationProp<ScheduledTaskRoutes>>();
  const insets = useSafeAreaInsets();
  const newTask = () => {
    if (visibleEnvironments.length === 0) return;
    resetEditor();
    navigation.navigate("SettingsScheduledTaskNew");
  };

  return (
    <>
      <SettingsEnvironmentFilterHeader
        trailingItems={[
          withNativeGlassHeaderItem({
            type: "button",
            label: "",
            accessibilityLabel: translator.message("mobile.navigation.newTask"),
            icon: { type: "sfSymbol", name: "plus" } as const,
            disabled: visibleEnvironments.length === 0,
            onPress: newTask,
          }),
        ]}
      />
      <SettingsScreen
        title={translator.message("mobile.settings.scheduledTasks")}
        trailing={
          <View className="flex-row items-center">
            <AndroidSettingsEnvironmentFilter />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translator.message("mobile.navigation.newTask")}
              accessibilityState={{ disabled: visibleEnvironments.length === 0 }}
              disabled={visibleEnvironments.length === 0}
              onPress={newTask}
              className="size-11 items-center justify-center rounded-full disabled:opacity-50"
            >
              <SymbolView name="plus" size={22} tintColorClassName="accent-icon" />
            </Pressable>
          </View>
        }
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {visibleEnvironments.length > 0 ? (
            visibleEnvironments.map((environment) => (
              <EnvironmentTasks
                key={environment.environmentId}
                environment={environment}
                now={now}
                projectIds={
                  selectedProjectKey === null
                    ? null
                    : (selectedGroup?.members
                        .filter(
                          (member) => member.project.environmentId === environment.environmentId,
                        )
                        .map((member) => member.project.id) ?? [])
                }
                onEdit={(task) => {
                  startEditor({
                    environmentId: environment.environmentId,
                    environmentLabel: environment.label,
                    draft: editDraft(task),
                  });
                  navigation.navigate("SettingsScheduledTaskEdit");
                }}
              />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? translator.message("mobile.ui.connectAnEnvironmentToViewAndCreate")
                : translator.message("mobile.ui.noEnvironmentsMatchTheseFiltersChangeThe")}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

// The "New task" action and takeScheduledTaskNewLink clear the editor before
// this screen opens, so it starts from the default target.
export function SettingsScheduledTaskNewRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  return (
    <SettingsScheduledTaskEditorScreen title={translator.message("mobile.ui.newScheduledTask")} />
  );
}

export function SettingsScheduledTaskEditRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  return (
    <SettingsScheduledTaskEditorScreen title={translator.message("mobile.ui.editScheduledTask")} />
  );
}

function SettingsScheduledTaskEditorScreen({ title }: { readonly title: string }) {
  const translator = useMobileInterfaceTranslator();
  const { editor, voiceOwnerKey, readEditor, setEditor, hasChanges, draftForEnvironment } =
    useScheduledTaskEditor();
  const { availableTargets } = useSettingsEnvironmentFilter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  // Set once the save lands, so the removal guard lets the editor close.
  const saved = useRef(false);
  const ownerKey = editor ? `${voiceOwnerKey}:${editor.environmentId}` : null;
  const prompt = editor?.draft.prompt ?? "";
  const [selectionState, setSelectionState] = useState<{
    readonly ownerKey: string | null;
    readonly selection: ComposerEditorSelection;
  } | null>(null);
  const selection =
    selectionState?.ownerKey === ownerKey
      ? selectionState.selection
      : { start: prompt.length, end: prompt.length };
  const setSelection = (next: ComposerEditorSelection) =>
    setSelectionState({ ownerKey, selection: next });
  const setPrompt = (next: string) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            draft: { ...current.draft, prompt: next },
          }
        : current,
    );
  const voiceInput = useVoiceInputController({
    ownerKey,
    label: editor?.draft.title.trim() || title,
    subscribeToDraftChanges: (onChange) =>
      appAtomRegistry.subscribe(scheduledTaskEditorSessionAtom, onChange),
    selection,
    readDraftMessage: () => {
      const current = readEditor();
      if (current?.environmentId !== editor?.environmentId) return null;
      return current?.draft.prompt ?? null;
    },
    onChangeSelection: setSelection,
    onChangeDraftMessage: (text) => {
      if (readEditor()?.environmentId === editor?.environmentId) setPrompt(text);
    },
    disabled: saving,
  });
  const preventRemove = hasChanges || saving;
  usePreventRemove(preventRemove, ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (saving) {
      Dialog.alert(
        translator.message("mobile.ui.savingTask"),
        translator.message("mobile.ui.waitForTheTaskToFinishSaving"),
      );
      return;
    }
    Dialog.alert(
      translator.message("mobile.git.discardTitle"),
      translator.message("mobile.ui.yourUnsavedChangesWillBeLost"),
      [
        { text: translator.message("mobile.ui.keepEditing"), style: "cancel" },
        {
          text: translator.message("settings.voice.options.cancel"),
          style: "destructive",
          onPress: () => {
            if (voiceInput.isBusy) voiceInput.cancel();
            discardScheduledTaskEditor();
            navigation.dispatch(data.action);
          },
        },
      ],
    );
  });
  return (
    <SettingsScreen title={title}>
      {Platform.OS === "ios" ? (
        <NativeStackScreenOptions
          options={{
            headerBackVisible: false,
            gestureEnabled: !preventRemove,
            // Native Back pops before removal guards; a bar action lets the guard run first.
            unstable_headerLeftItems: () => [
              withNativeGlassHeaderItem({
                type: "button",
                label: "",
                accessibilityLabel: translator.message("browser.files.back"),
                icon: { type: "sfSymbol", name: "chevron.backward" },
                onPress: () => navigation.goBack(),
              }),
            ],
          }}
        />
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {editor ? (
          <TaskForm
            key={editor.environmentId}
            environmentId={editor.environmentId}
            environmentLabel={
              availableTargets.find((target) => target.environmentId === editor.environmentId)
                ?.label ?? editor.environmentLabel
            }
            availableTargets={availableTargets}
            draft={editor.draft}
            saving={saving}
            setSaving={setSaving}
            dictationPending={voiceInput.blocksSubmission}
            promptField={
              <ScheduledTaskPromptField
                value={prompt}
                onChange={setPrompt}
                selection={selection}
                onChangeSelection={setSelection}
                disabled={saving}
                voiceInput={voiceInput}
              />
            }
            setDraft={(draft) => {
              if (!saving) setEditor({ ...editor, draft });
            }}
            onSaved={() => {
              saved.current = true;
              markScheduledTaskEditorSaved();
              if (navigation.isFocused()) navigation.goBack();
            }}
            onChangeEnvironment={(target) => {
              if (target.environmentId === editor.environmentId) return;
              setEditor({
                environmentId: target.environmentId,
                environmentLabel: target.label,
                draft: {
                  ...draftForEnvironment(target.environmentId),
                  title: editor.draft.title,
                  prompt: editor.draft.prompt,
                  schedule: editor.draft.schedule,
                  enabled: editor.draft.enabled,
                },
              });
            }}
          />
        ) : (
          <Text className="px-2 text-base text-foreground-muted">
            {availableTargets.length === 0
              ? translator.message("mobile.ui.connectAnEnvironmentToCreateAScheduled")
              : translator.message("mobile.ui.noEnvironmentsMatchTheCurrentFiltersChange")}
          </Text>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function TaskForm({
  environmentId,
  environmentLabel,
  availableTargets,
  draft,
  saving,
  setSaving,
  dictationPending,
  promptField,
  setDraft,
  onSaved,
  onChangeEnvironment,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly availableTargets: readonly SettingsTarget[];
  readonly draft: Draft;
  readonly saving: boolean;
  readonly setSaving: (saving: boolean) => void;
  readonly dictationPending: boolean;
  readonly promptField: ReactNode;
  readonly setDraft: (draft: Draft) => void;
  readonly onSaved: () => void;
  readonly onChangeEnvironment: (target: SettingsTarget) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation<NativeStackNavigationProp<ScheduledTaskRoutes>>();
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  // Pinned first. The chosen project stays listed after it is archived.
  const projects = useProjects()
    .filter(
      (project) =>
        project.environmentId === environmentId &&
        (project.archivedAt == null ||
          project.id === draft.projectId ||
          project.id === draft.task?.projectId),
    )
    .sort((left, right) => Number(right.pinnedAt != null) - Number(left.pinnedAt != null));
  const destinationThreads = useThreadShells().filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === draft.projectId &&
      thread.deletedAt == null,
  );
  const config = useEnvironmentServerConfig(environmentId);
  const modelOptions = buildModelOptions(config, null, undefined, draft.projectId);
  // Existing webhook tasks keep the option so they can still switch to a timer.
  const webhookDenial = managedCapabilityDenial(config?.managedPolicy, "webhookTasks");
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "scheduled task upsert",
    reportFailure: false,
  });
  const submissionPending = useRef(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [runAtPicker, setRunAtPicker] = useState<"date" | "time" | null>(null);
  const taskMissing =
    draft.task !== null &&
    tasks.data !== null &&
    !tasks.data.tasks.some((task) => task.id === draft.task?.id);
  const environmentUnavailable = !availableTargets.some(
    (target) => target.environmentId === environmentId,
  );

  const failure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Dialog.alert(title, String(squashAtomCommandFailure(result)));
    }
  };

  const offersOnce =
    config?.environment.capabilities.oneTimeSchedules === true ||
    draft.task?.schedule.type === "once";
  const save = async () => {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      submissionPending.current ||
      saving ||
      dictationPending ||
      taskMissing ||
      environmentUnavailable
    )
      return;
    // Keep remote edits until this form changes signature configuration.
    const liveTask = tasks.data?.tasks.find((task) => task.id === draft.task?.id);
    const schedule = scheduleFromDraft(
      draft.schedule.mode === "webhook" &&
        !draft.schedule.signatureEdited &&
        liveTask?.schedule.type === "webhook"
        ? { ...draft.schedule, signature: liveTask.schedule.signature }
        : draft.schedule,
    );
    if (
      draft.schedule.mode === "webhook" &&
      parseMaxDeliveryAge(draft.schedule.maxDeliveryAgeMinutes) === undefined
    ) {
      Dialog.alert(
        translator.message("mobile.ui.invalidAgeLimit"),
        `Enter whole minutes from 1 to ${MAX_WEBHOOK_DELIVERY_AGE_MINUTES}, or leave it blank.`,
      );
      return;
    }
    if (draft.schedule.mode === "once" && !offersOnce) {
      Dialog.alert(
        translator.message("mobile.ui.onceIsNotAvailableHere"),
        translator.message("mobile.ui.thisEnvironmentRunsAnOlderT3Code"),
      );
      return;
    }
    const parsedFilters = parseWebhookFilterDrafts(draft.schedule.filters);
    if (draft.schedule.mode === "webhook" && "error" in parsedFilters) {
      Dialog.alert(translator.message("mobile.ui.invalidFilter"), parsedFilters.error);
      return;
    }
    if (draft.schedule.mode === "webhook" && schedule === null) {
      Dialog.alert(
        translator.message("mobile.ui.invalidWebhookSettings"),
        translator.message("mobile.ui.eachDedupeKeyMustContainAValid"),
      );
      return;
    }
    if (
      !draft.title.trim() ||
      !draft.prompt.trim() ||
      !draft.projectId ||
      !draft.modelSelection ||
      !schedule ||
      (draft.workspace === "existing_worktree" && !draft.checkoutPath.trim())
    ) {
      Dialog.alert(
        translator.message("mobile.ui.incompleteTask"),
        translator.message("mobile.ui.addANamePromptProjectModelValid"),
      );
      return;
    }
    if (!projects.some((project) => project.id === draft.projectId)) {
      Dialog.alert(
        translator.message("mobile.ui.projectUnavailable"),
        translator.message("mobile.ui.chooseAProjectInThisEnvironment"),
      );
      return;
    }
    if (
      draft.destinationThreadId !== null &&
      !destinationThreads.some((thread) => thread.id === draft.destinationThreadId) &&
      draft.destinationThreadId !== draft.task?.threadId
    ) {
      Dialog.alert(translator.message("mobile.projects.tasks.destinationUnavailable"));
      return;
    }
    if (
      schedule.type === "webhook" &&
      schedule.signature &&
      !draft.schedule.signatureSecret.trim() &&
      !liveTask?.webhook?.hasSecret
    ) {
      Dialog.alert(translator.message("mobile.projects.tasks.secretRequired"));
      return;
    }
    const input: ScheduledTaskUpsertInput = {
      ...(draft.task ? { id: draft.task.id, requireExisting: true } : {}),
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      projectId: draft.projectId,
      modelSelection: draft.modelSelection,
      schedule,
      enabled: draft.enabled,
      threadId: draft.destinationThreadId,
      workspaceStrategy:
        draft.workspace === "root"
          ? { type: "root" }
          : draft.workspace === "existing_worktree"
            ? { type: "existing_worktree", worktreePath: draft.checkoutPath.trim() }
            : {
                type: "worktree",
                baseRef: draft.baseRef.trim() || "main",
                startFromOrigin: draft.startFromOrigin,
              },
      // Tasks have no mode picker; a mode above the administrator's ceiling is refused.
      runtimeMode:
        clampManagedRuntimeMode(config?.managedPolicy, draft.runtimeMode) ?? draft.runtimeMode,
      interactionMode: draft.task?.interactionMode ?? "default",
      creationSource: draft.task?.creationSource ?? "mobile",
    };
    submissionPending.current = true;
    setSaving(true);
    const result = await upsert({ environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      submissionPending.current = false;
      failure("Could not save task", result);
      return;
    }
    setDraft({ ...draft, schedule: { ...draft.schedule, signatureSecret: "" } });
    onSaved();
  };

  return (
    <View className="gap-5">
      <View
        className="gap-5"
        pointerEvents={saving ? "none" : "auto"}
        accessibilityElementsHidden={saving}
        importantForAccessibility={saving ? "no-hide-descendants" : "auto"}
      >
        {taskMissing ? (
          <Text className="px-1 text-base text-danger-foreground">
            {translator.message("mobile.ui.thisTaskNoLongerExists")}
          </Text>
        ) : null}

        {environmentUnavailable ? (
          <Text className="px-1 text-base text-danger-foreground">
            {translator.message("mobile.ui.thisEnvironmentIsDisconnectedReconnectBeforeSaving")}
          </Text>
        ) : null}
        <SettingsSection>
          <SelectRow
            label={translator.message("mobile.ui.runsOn")}
            value={environmentLabel}
            valueIcon={
              <EnvironmentMachineSymbol
                kind={resolveEnvironmentMachineKind(config)}
                size={18}
                tintColorClassName="accent-foreground-muted"
              />
            }
            actions={
              draft.task || saving || dictationPending
                ? []
                : availableTargets.map((target) => ({
                    id: target.environmentId,
                    title: target.label,
                    image:
                      ENVIRONMENT_MACHINE_SYMBOLS[
                        resolveEnvironmentMachineKind(target.serverConfig)
                      ],
                    state: target.environmentId === environmentId ? "on" : undefined,
                  }))
            }
            onSelect={(id) => {
              const target = availableTargets.find((entry) => entry.environmentId === id);
              if (target) onChangeEnvironment(target);
            }}
          />
        </SettingsSection>
        <SettingsSection title={translator.message("mobile.ui.task")}>
          <FormField
            label={translator.message("settings.skills.name")}
            disabled={saving}
            value={draft.title}
            placeholder={translator.message("mobile.ui.checkForIssues")}
            onChange={(title) => setDraft({ ...draft, title })}
          />
          {promptField}
        </SettingsSection>

        <SettingsSection title={translator.message("settings.theme.editor.group.context")}>
          <SelectRow
            label={translator.message("mobile.navigation.project")}
            value={
              projects.find((project) => project.id === draft.projectId)?.title ??
              (projects.length
                ? translator.message("mobile.settings.harness.chooseProject")
                : translator.message("mobile.ui.noProjectsAvailable"))
            }
            actions={projects.map((project) => ({
              id: project.id,
              title: project.title,
              state: project.id === draft.projectId ? "on" : undefined,
            }))}
            onSelect={(id) => {
              const project = projects.find((item) => item.id === id);
              if (!project) return;
              const keepsExplicitModel =
                draft.modelSelectionIsExplicit &&
                (draft.modelSelection === null ||
                  !config?.settings ||
                  resolveProjectProviderInstanceEnabled(
                    config.settings,
                    project.id,
                    draft.modelSelection.instanceId,
                  ));
              setDraft({
                ...draft,
                projectId: project.id,
                destinationThreadId: null,
                modelSelection: keepsExplicitModel
                  ? draft.modelSelection
                  : scheduledTaskDefaultModel(config, project),
                modelSelectionIsExplicit: keepsExplicitModel,
              });
            }}
          />
          <PickerRow
            label={translator.message("chat.planEstimate.model")}
            borderTop
            value={
              modelOptions.find(
                (option) =>
                  option.selection.instanceId === draft.modelSelection?.instanceId &&
                  option.selection.model === draft.modelSelection?.model,
              )?.label ??
              draft.modelSelection?.model ??
              (modelOptions.length
                ? translator.message("mobile.settings.agents.chooseModel")
                : translator.message("mobile.ui.noModelsAvailable"))
            }
            onPress={() => navigation.navigate("SettingsScheduledTaskModel")}
            disabled={saving || dictationPending || environmentUnavailable}
          />
        </SettingsSection>

        <SettingsSection title={translator.message("mobile.projects.tasks.destination")}>
          <ProjectSettingsSelect
            label={translator.message("mobile.projects.tasks.destination")}
            value={draft.destinationThreadId ?? "new"}
            options={[
              { value: "new", label: translator.message("mobile.projects.tasks.newThread") },
              ...destinationThreads.map((thread) => ({ value: thread.id, label: thread.title })),
              ...(draft.destinationThreadId !== null &&
              !destinationThreads.some((thread) => thread.id === draft.destinationThreadId)
                ? [{ value: draft.destinationThreadId, label: draft.destinationThreadId }]
                : []),
            ]}
            disabled={saving || environmentUnavailable}
            onChange={(value) =>
              setDraft({
                ...draft,
                destinationThreadId:
                  value === "new"
                    ? null
                    : (destinationThreads.find((thread) => thread.id === value)?.id ??
                      draft.destinationThreadId),
              })
            }
          />
          <Text className="px-4 pb-3 text-sm text-foreground-muted">
            {translator.message(
              draft.destinationThreadId
                ? "mobile.projects.tasks.continueThread"
                : "mobile.projects.tasks.newThreadDescription",
            )}
          </Text>
        </SettingsSection>
        <SettingsSection
          title={translator.message("mobile.settings.projects.settings.workspaceTitle")}
        >
          <SelectRow
            label={translator.message("mobile.ui.runIn")}
            value={
              draft.workspace === "worktree"
                ? "New worktree"
                : draft.workspace === "root"
                  ? "Project checkout"
                  : "Specific checkout"
            }
            actions={[
              {
                id: "worktree",
                title: translator.message("mobile.settings.projects.settings.newWorktree"),
                state: draft.workspace === "worktree" ? "on" : undefined,
              },
              {
                id: "root",
                title: translator.message("mobile.ui.projectCheckout"),
                state: draft.workspace === "root" ? "on" : undefined,
              },
              {
                id: "existing_worktree",
                title: translator.message("mobile.ui.specificCheckout"),
                state: draft.workspace === "existing_worktree" ? "on" : undefined,
              },
            ]}
            onSelect={(id) => {
              if (id === "worktree" || id === "root" || id === "existing_worktree")
                setDraft({ ...draft, workspace: id });
            }}
          />
          {draft.workspace === "worktree" ? (
            <PickerRow
              label={translator.message("mobile.thread.baseBranch")}
              value={resolveNewTaskBranchLabel({
                branchName: draft.baseRef,
                startFromOrigin: draft.startFromOrigin,
                workspaceMode: "worktree",
              })}
              borderTop
              disabled={!draft.projectId || saving || dictationPending || environmentUnavailable}
              onPress={() => navigation.navigate("SettingsScheduledTaskBranch")}
            />
          ) : null}
          {draft.workspace === "existing_worktree" ? (
            <FormField
              label={translator.message("mobile.ui.checkoutPath")}
              disabled={saving}
              value={draft.checkoutPath}
              borderTop
              onChange={(checkoutPath) =>
                setDraft({
                  ...draft,
                  checkoutPath: resolvePastedPath(draft.checkoutPath, checkoutPath),
                })
              }
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title={translator.message("mobile.ui.schedule")}>
          <View className="px-4 py-3">
            <SegmentedControl
              variant="card"
              options={[
                { value: "fixed_time", label: translator.message("mobile.ui.atATime") },
                // Older servers reject one-time schedules on save.
                ...(offersOnce || draft.schedule.mode === "once"
                  ? [{ value: "once" as const, label: translator.message("mobile.ui.once") }]
                  : []),
                {
                  value: "interval",
                  label: translator.message("settings.diagnostics.history.interval"),
                },
                ...(webhookDenial === undefined || draft.schedule.mode === "webhook"
                  ? [
                      {
                        value: "webhook" as const,
                        label: translator.message("mobile.ui.onWebhook"),
                      },
                    ]
                  : []),
              ]}
              selected={draft.schedule.mode}
              onSelect={(mode) => {
                setTimePickerOpen(false);
                setRunAtPicker(null);
                setDraft({
                  ...draft,
                  prompt:
                    mode === "webhook" && !draft.prompt.trim()
                      ? DEFAULT_WEBHOOK_PROMPT
                      : draft.prompt,
                  schedule: {
                    ...draft.schedule,
                    mode,
                    runAt:
                      mode === "once" && !draft.schedule.runAt
                        ? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString()
                        : draft.schedule.runAt,
                  },
                });
              }}
            />
          </View>
          {draft.schedule.mode === "fixed_time" ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Time, ${formatTime(draft.schedule.timeOfDay)}`}
                onPress={() => setTimePickerOpen((open) => !open)}
                className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
              >
                <Text textRole="body" className="text-foreground">
                  {translator.message("settings.diagnostics.table.time")}
                </Text>
                <Text
                  textRole="footnote"
                  className="min-w-0 flex-1 text-right text-foreground-muted"
                >
                  {formatTime(draft.schedule.timeOfDay)}
                </Text>
                <SymbolView
                  name="chevron.right"
                  size={14}
                  tintColorClassName="accent-chevron"
                  type="monochrome"
                />
              </Pressable>
              {timePickerOpen ? (
                <DateTimePicker
                  value={timePickerValue(draft.schedule.timeOfDay)}
                  mode="time"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onDismiss={() => setTimePickerOpen(false)}
                  onValueChange={(_, selected) => {
                    const timeOfDay = `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`;
                    setDraft({ ...draft, schedule: { ...draft.schedule, timeOfDay } });
                  }}
                />
              ) : null}
              <SelectRow
                label={translator.message("mobile.ui.repeat")}
                value={repeatLabel(draft.schedule.weekdays)}
                borderTop
                actions={[
                  {
                    id: "every_day",
                    title: translator.message("mobile.ui.everyDay"),
                    state: draft.schedule.weekdays.length === 7 ? "on" : undefined,
                  },
                  {
                    id: "weekdays",
                    title: translator.message("mobile.ui.weekdays"),
                    state: repeatLabel(draft.schedule.weekdays) === "Weekdays" ? "on" : undefined,
                  },
                  ...DAYS.map((day) => ({
                    id: String(day.index),
                    title: day.label,
                    attributes: { keepsMenuPresented: true },
                    state: draft.schedule.weekdays.includes(day.index)
                      ? ("on" as const)
                      : undefined,
                  })),
                ]}
                onSelect={(id) => {
                  const weekdays =
                    id === "every_day"
                      ? DAYS.map((day) => day.index)
                      : id === "weekdays"
                        ? [1, 2, 3, 4, 5]
                        : (() => {
                            const day = DAYS.find((item) => String(item.index) === id);
                            if (!day) return draft.schedule.weekdays;
                            return draft.schedule.weekdays.includes(day.index)
                              ? draft.schedule.weekdays.filter((index) => index !== day.index)
                              : [...draft.schedule.weekdays, day.index];
                          })();
                  setDraft({ ...draft, schedule: { ...draft.schedule, weekdays } });
                }}
              />
            </>
          ) : draft.schedule.mode === "webhook" && webhookDenial !== undefined && draft.enabled ? (
            <Text className="border-t border-border-subtle px-4 py-3 text-sm text-foreground-muted">
              {`${webhookDenial} Switch the task to a timer, or turn it off, to save it.`}
            </Text>
          ) : draft.schedule.mode === "once" ? (
            (["date", "time"] as const).map((field) => {
              const runAt = new Date(draft.schedule.runAt);
              const label = field === "date" ? formatRunAtDate(runAt) : formatRunAtTime(runAt);
              return (
                <View key={field}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${field === "date" ? translator.message("mobile.ui.date") : translator.message("mobile.ui.time")}, ${label}`}
                    onPress={() => setRunAtPicker((open) => (open === field ? null : field))}
                    className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
                  >
                    <Text textRole="body" className="text-foreground">
                      {field === "date"
                        ? translator.message("mobile.ui.date")
                        : translator.message("settings.diagnostics.table.time")}
                    </Text>
                    <Text
                      textRole="footnote"
                      className="min-w-0 flex-1 text-right text-foreground-muted"
                    >
                      {label}
                    </Text>
                    <SymbolView
                      name="chevron.right"
                      size={14}
                      tintColorClassName="accent-chevron"
                      type="monochrome"
                    />
                  </Pressable>
                  {runAtPicker === field ? (
                    <DateTimePicker
                      value={runAt}
                      mode={field}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onDismiss={() => setRunAtPicker(null)}
                      onValueChange={(_, selected) => {
                        // Android shows a dialog that closes on pick; iOS stays inline.
                        if (Platform.OS === "android") setRunAtPicker(null);
                        setDraft({
                          ...draft,
                          schedule: { ...draft.schedule, runAt: selected.toISOString() },
                        });
                      }}
                    />
                  ) : null}
                </View>
              );
            })
          ) : draft.schedule.mode === "webhook" ? (
            <>
              <WebhookScheduleDetails
                environmentId={environmentId}
                // Use the live row for rotated URLs; hide the URL once a loaded list no longer contains the task.
                task={
                  tasks.data
                    ? (tasks.data.tasks.find((task) => task.id === draft.task?.id) ?? null)
                    : draft.task
                }
                disabled={!canOperate || saving || environmentUnavailable}
              />
              <WebhookSignatureSettings
                schedule={draft.schedule}
                hasSavedSecret={draft.task?.webhook?.hasSecret === true}
                disabled={saving || !canOperate || environmentUnavailable}
                onChange={(schedule) => setDraft({ ...draft, schedule })}
              />
              <FormField
                label={translator.message("mobile.ui.skipRequestsOlderThanMinutes")}
                value={draft.schedule.maxDeliveryAgeMinutes}
                placeholder={translator.message("mobile.ui.runEveryRequest")}
                keyboardType="number-pad"
                disabled={saving}
                borderTop
                onChange={(maxDeliveryAgeMinutes) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, maxDeliveryAgeMinutes } })
                }
              />
              <WebhookFilterRows
                filters={draft.schedule.filters}
                disabled={saving}
                onChange={(filters) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, filters } })
                }
              />
              <FormField
                label={translator.message("mobile.ui.duplicateRequestKey")}
                value={draft.schedule.replayKey}
                placeholder="{{headers.delivery-id}}"
                disabled={saving}
                borderTop
                onChange={(replayKey) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, replayKey } })
                }
              />
              <Text className="px-4 pb-3 text-sm text-foreground-muted">
                {translator.message("mobile.ui.requestsWithTheSameKeyRunOnly")}
              </Text>
              <FormField
                label={translator.message("mobile.ui.coalesceKeyTemplate")}
                value={draft.schedule.coalesceKey}
                placeholder="{{body.id}}"
                disabled={saving}
                borderTop
                onChange={(coalesceKey) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, coalesceKey } })
                }
              />
              <FormField
                label={translator.message("mobile.ui.coalesceWindowSeconds103600")}
                value={draft.schedule.coalesceWindowSeconds}
                placeholder="120"
                keyboardType="number-pad"
                disabled={saving}
                borderTop
                onChange={(coalesceWindowSeconds) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, coalesceWindowSeconds } })
                }
              />
              <Text className="px-4 pb-3 text-sm text-foreground-muted">
                {translator.message("mobile.ui.coalescingRunsTheLatestPayloadWhenThe")}
              </Text>
            </>
          ) : (
            <>
              <FormField
                label={translator.message("mobile.ui.minutesBetweenRuns")}
                value={draft.schedule.intervalMinutes}
                keyboardType="decimal-pad"
                disabled={saving}
                borderTop
                onChange={(intervalMinutes) =>
                  setDraft({ ...draft, schedule: { ...draft.schedule, intervalMinutes } })
                }
              />
              {!(parseIntervalMinutes(draft.schedule.intervalMinutes) >= 1) ? (
                <Text className="px-4 pb-3 text-sm text-danger-foreground">
                  {translator.message("mobile.ui.intervalsMustBeAtLeast1Minute")}
                </Text>
              ) : draft.task?.schedule.type === "interval" &&
                draft.task.schedule.everyMs < 60_000 ? (
                <Text className="px-4 pb-3 text-sm text-foreground-muted">
                  {translator.message("mobile.ui.thisTaskPreviouslyRanMoreThanOnce")}
                </Text>
              ) : null}
            </>
          )}
          <View className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3">
            <Text textRole="body" className="min-w-0 flex-1 text-foreground">
              {translator.message("common.enabled")}
            </Text>
            <ThemedSwitch
              accessibilityLabel={translator.message("mobile.ui.taskEnabled")}
              value={draft.enabled}
              onValueChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </View>
        </SettingsSection>
        {draft.schedule.mode === "fixed_time" ? (
          <Text className="px-2 text-sm text-foreground-muted">
            {translator.message("mobile.ui.timeUsesTheEnvironmentsTimeZoneWhich")}
          </Text>
        ) : null}
      </View>
      <Button
        tone="primary"
        fullWidth
        loading={saving}
        disabled={
          !canOperate ||
          dictationPending ||
          taskMissing ||
          environmentUnavailable ||
          // The server refuses an enabled webhook task under this policy.
          (draft.enabled && draft.schedule.mode === "webhook" && webhookDenial !== undefined)
        }
        onPress={() => void save()}
        label={
          saving
            ? translator.message("mobile.settings.agents.saving")
            : draft.task
              ? translator.message("settings.theme.editor.saveChanges")
              : translator.message("mobile.ui.createTask")
        }
      />
    </View>
  );
}

function WebhookScheduleDetails({
  environmentId,
  task,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask | null;
  readonly disabled: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const [rotating, setRotating] = useState(false);
  const rotate = useAtomCommand(serverEnvironment.rotateScheduledTaskWebhookToken, {
    label: "scheduled task rotate webhook token",
    reportFailure: false,
  });
  const preparedConnection = usePreparedConnection(environmentId);
  const httpBaseUrl =
    preparedConnection._tag === "Some" ? preparedConnection.value.httpBaseUrl : null;
  const webhook = task?.schedule.type === "webhook" ? task.webhook : undefined;
  const resolved = webhook ? webhookAddress(webhook, httpBaseUrl) : null;
  return (
    <View className="gap-2 border-t border-border-subtle px-4 py-3">
      <Text className="text-sm text-foreground-muted">
        {
          "The prompt can use {{body.a.b}}, {{headers.name}}, {{query.name}}, {{body}} and {{request}}. The filled-in prompt is all the agent sees."
        }
      </Text>
      {task === null || resolved === null ? (
        <Text className="text-sm text-foreground-muted">
          {translator.message("mobile.ui.saveTheTaskToGetItsWebhook")}
        </Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translator.message("mobile.ui.copyWebhookUrl")}
            accessibilityHint={translator.message("mobile.ui.copiesTheUrlToTheClipboard")}
            disabled={!resolved.copyable}
            onPress={() => void tryCopyTextWithHaptic(resolved.address)}
            className="gap-1 active:opacity-70"
          >
            <Text textRole="body" className="text-foreground">
              {resolved.copyable
                ? translator.message("mobile.ui.webhookUrl")
                : translator.message("mobile.ui.webhookPath")}
            </Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={2} selectable>
              {resolved.address}
            </Text>
          </Pressable>
          {resolved.note !== null ? (
            <Text className="text-sm text-foreground-muted">{resolved.note}</Text>
          ) : null}
          <Button
            label={
              rotating
                ? translator.message("mobile.ui.rotating")
                : translator.message("mobile.ui.rotateUrl")
            }
            tone="danger"
            disabled={disabled || rotating}
            onPress={() =>
              Dialog.alert(
                translator.message("mobile.ui.rotateUrl2"),
                translator.message("mobile.ui.theCurrentUrlStopsWorkingImmediately"),
                [
                  {
                    text: translator.message("mobile.settings.projects.settings.cancel"),
                    style: "cancel",
                  },
                  {
                    text: translator.message("settings.integrations.rotate"),
                    style: "destructive",
                    onPress: () => {
                      setRotating(true);
                      void rotate({ environmentId, input: { id: task.id } }).then((result) => {
                        setRotating(false);
                        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                          Dialog.alert(
                            translator.message("mobile.ui.couldNotRotateUrl"),
                            String(squashAtomCommandFailure(result)),
                          );
                        }
                      });
                    },
                  },
                ],
              )
            }
            loading={rotating}
          />
        </>
      )}
      {task?.schedule.type === "webhook" ? (
        <WebhookDeliveriesSettings environmentId={environmentId} task={task} />
      ) : null}
    </View>
  );
}

function EnvironmentTasks({
  environment,
  now,
  projectIds,
  onEdit,
}: {
  readonly environment: SettingsTarget;
  readonly now: number;
  readonly projectIds: readonly ProjectId[] | null;
  readonly onEdit: (task: ScheduledTask) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = environment.environmentId;
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const visibleTasks = tasks.data?.tasks.filter(
    (task) => projectIds === null || projectIds.includes(task.projectId),
  );
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "scheduled task enabled",
    reportFailure: false,
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scheduled task run",
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "scheduled task delete",
    reportFailure: false,
  });
  const failure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Dialog.alert(title, String(squashAtomCommandFailure(result)));
    }
  };

  const act = async (task: ScheduledTask, action: "run" | "toggle" | "delete") => {
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    const result =
      action === "run"
        ? await runNow({ environmentId, input: { id: task.id } })
        : action === "toggle"
          ? await setEnabled({ environmentId, input: { id: task.id, enabled: !task.enabled } })
          : await remove({ environmentId, input: { id: task.id } });
    failure(`Could not ${action === "toggle" ? "update" : action} task`, result);
  };

  return (
    <SettingsSection
      title={environment.label}
      titleIcon={
        <EnvironmentMachineSymbol
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          size={16}
          tintColorClassName={
            Platform.OS === "android" ? "accent-primary" : "accent-foreground-muted"
          }
        />
      }
    >
      {tasks.error ? (
        <Text className="p-4 text-base text-danger-foreground">{tasks.error}</Text>
      ) : !tasks.data ? (
        <Text className="p-4 text-base text-foreground-muted">
          {translator.message("mobile.ui.loadingTasks")}
        </Text>
      ) : visibleTasks?.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">
          {projectIds === null
            ? translator.message("mobile.ui.noScheduledTasksYet")
            : translator.message("mobile.ui.noTasksInThisProject")}
        </Text>
      ) : (
        visibleTasks?.map((task, index) => (
          <View
            key={task.id}
            className={
              index === 0
                ? "flex-row items-start gap-1 px-4 py-3"
                : "flex-row items-start gap-1 border-t border-border-subtle px-4 py-3"
            }
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${task.title}`}
              onPress={() => {
                onEdit(task);
              }}
              className="min-w-0 flex-1 gap-1 active:opacity-70"
            >
              <Text textRole="body" className="text-foreground" numberOfLines={1}>
                {task.title}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                {describeSchedule(task)}
                {!task.enabled
                  ? " · Paused"
                  : task.nextRunAt
                    ? ` · ${formatNextScheduledTaskRun(task.nextRunAt, now)}`
                    : ""}
              </Text>
              {task.blockedByPolicy ? (
                <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                  {task.blockedByPolicy}
                </Text>
              ) : null}
              {task.lastRunError ? (
                <Text className="text-sm text-danger-foreground" numberOfLines={2}>
                  Last run failed: {task.lastRunError}
                </Text>
              ) : null}
            </Pressable>
            <Menu
              actions={[
                { id: "edit", title: translator.message("common.edit") },
                {
                  id: "toggle",
                  title: task.enabled
                    ? translator.message("common.pause")
                    : translator.message("common.resume"),
                  attributes: { disabled: !canOperate },
                },
                ...(task.schedule.type === "webhook"
                  ? []
                  : [
                      {
                        id: "run",
                        title: translator.message("mobile.ui.runNow"),
                        attributes: { disabled: !canOperate },
                      },
                    ]),
                {
                  id: "delete",
                  title: translator.message("mobile.git.delete"),
                  attributes: { destructive: true, disabled: !canOperate },
                },
              ]}
              onPressAction={({ nativeEvent }) => {
                const action = nativeEvent.event;
                if (action === "edit") {
                  onEdit(task);
                } else if (action === "delete") {
                  Dialog.alert(translator.message("mobile.ui.deleteTask"), task.title, [
                    {
                      text: translator.message("mobile.settings.projects.settings.cancel"),
                      style: "cancel",
                    },
                    {
                      text: translator.message("mobile.git.delete"),
                      style: "destructive",
                      onPress: () => void act(task, "delete"),
                    },
                  ]);
                } else if (action === "toggle" || action === "run") {
                  void act(task, action);
                }
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${task.title}`}
                className="h-11 w-11 items-center justify-center"
              >
                <SymbolView
                  name="ellipsis"
                  size={18}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              </Pressable>
            </Menu>
          </View>
        ))
      )}
    </SettingsSection>
  );
}
