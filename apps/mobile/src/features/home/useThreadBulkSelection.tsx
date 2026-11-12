import { CommandPaletteButton } from "../keyboard/CommandPaletteButton";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom } from "../../state/preferences";
import { readEnvironmentScope } from "../../state/session";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { CustomSnoozeSheet } from "../threads/CustomSnoozeSheet";
import { confirmThreadAction, shouldConfirmThreadAction } from "./thread-action-confirmation";
import { planThreadBulkAction, type ThreadBulkAction } from "./thread-bulk-actions";
import { useThreadListActions } from "./useThreadListActions";

const BULK_ACTION_LABELS = {
  settle: "mobile.thread.settle",
  snooze: "mobile.thread.snooze",
  unpin: "mobile.thread.unpin",
  "regenerate-title": "sidebar.thread.menu.regenerate",
  "mark-unread": "sidebar.thread.menu.markUnread",
  archive: "mobile.thread.archive",
  delete: "mobile.thread.delete",
} as const;

export function useThreadBulkSelection(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  now: string,
) {
  const translator = useMobileInterfaceTranslator();
  const [active, setActive] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const environments = useAtomValue(threadListEnvironmentsAtom);
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : {};
  const actions = useThreadListActions();
  const selectedThreads = threads.filter((thread) =>
    selectedKeys.has(scopedThreadKey(thread.environmentId, thread.id)),
  );
  const plan = (action: ThreadBulkAction, at = now) =>
    planThreadBulkAction({
      ...environments,
      action,
      threads: selectedThreads,
      operateEnvironmentIds: new Set(
        selectedThreads
          .filter((thread) =>
            readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
          )
          .map((thread) => thread.environmentId),
      ),
      now: at,
    });
  const toggle = (thread: EnvironmentThreadShell) => {
    if (busy) return;
    const key = scopedThreadKey(thread.environmentId, thread.id);
    setActive(true);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const run = async (action: ThreadBulkAction, snoozedUntil?: string) => {
    if (busy) return;
    const planned = plan(action, new Date().toISOString());
    if (planned.disabled) return;
    if (
      (action === "unpin" || action === "archive" || action === "delete") &&
      shouldConfirmThreadAction(action, preferences)
    ) {
      if (!(await confirmThreadAction(action, planned.threads.length))) return;
    }
    if (plan(action, new Date().toISOString()).disabled) return;
    setBusy(true);
    await (async () => {
      for (const thread of planned.threads) {
        const succeeded =
          action === "settle"
            ? await actions.settleThread(thread)
            : action === "snooze"
              ? snoozedUntil !== undefined && (await actions.snoozeThread(thread, snoozedUntil))
              : action === "unpin"
                ? await actions.unpinThread(thread, { confirm: false })
                : action === "regenerate-title"
                  ? await actions.regenerateThreadTitle(thread)
                  : action === "mark-unread"
                    ? await actions.markThreadUnread(thread)
                    : action === "archive"
                      ? await actions.archiveThread(thread, { confirm: false })
                      : await actions.deleteThread(thread, { confirm: false });
        if (!succeeded) continue;
        setSelectedKeys((current) => {
          const next = new Set(current);
          next.delete(scopedThreadKey(thread.environmentId, thread.id));
          return next;
        });
      }
    })().finally(() => {
      setBusy(false);
    });
  };
  const toolbar = (shown: ReadonlyArray<EnvironmentThreadShell>) => (
    <View className="flex-row flex-wrap items-center gap-3 px-4 py-2">
      <CommandPaletteButton />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        className="min-h-11 justify-center"
        onPress={() => {
          setActive(!active);
          setSelectedKeys(new Set());
        }}
      >
        <AppText className="text-sm text-primary">
          {translator.message(active ? "mobile.home.selection.cancel" : "mobile.home.select")}
        </AppText>
      </Pressable>
      {active ? (
        <>
          <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
            {translator.message("mobile.home.selected", { count: selectedThreads.length })}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            className="min-h-11 justify-center"
            onPress={() =>
              setSelectedKeys(
                new Set(shown.map((thread) => scopedThreadKey(thread.environmentId, thread.id))),
              )
            }
          >
            <AppText className="text-sm text-primary">
              {translator.message("mobile.home.selectAll")}
            </AppText>
          </Pressable>
          <Menu
            actions={(Object.keys(BULK_ACTION_LABELS) as ThreadBulkAction[]).map((action) => ({
              id: action,
              title: translator.message(BULK_ACTION_LABELS[action]),
              attributes: {
                disabled: busy || plan(action).disabled,
                destructive: action === "delete",
              },
            }))}
            onPressAction={({ nativeEvent }) => {
              const action = nativeEvent.event as ThreadBulkAction;
              if (!(action in BULK_ACTION_LABELS)) return;
              if (action === "snooze") setSnoozeOpen(true);
              else void run(action);
            }}
          >
            <View className="min-h-11 justify-center">
              <AppText className="text-sm text-primary">
                {translator.message("mobile.home.selection.actions")}
              </AppText>
            </View>
          </Menu>
        </>
      ) : null}
      {snoozeOpen ? (
        <CustomSnoozeSheet
          onClose={() => setSnoozeOpen(false)}
          onSnooze={(until) => {
            setSnoozeOpen(false);
            void run("snooze", until);
          }}
        />
      ) : null}
    </View>
  );
  return { active, selectedKeys, toggle, toolbar };
}
