import {
  createThreadNotificationGate,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
} from "@t3tools/client-runtime/thread-notifications";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import { Discovery } from "@t3tools/client-runtime/relay";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { appAtomRegistry as registry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { mobilePreferencesAtom } from "../../state/preferences";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import { resolveThreadListV2Status, threadHasUnseenCompletion } from "../threads/threadListV2";
import { getAgentAwarenessRegistrationStatus } from "./remoteRegistration";
import {
  mobileNotificationBadgeCount,
  mobileNotificationDelivery,
} from "./local-notification-decisions";
import { errorsAndWarningsSuppressed } from "./notificationSuppression";

type Notice = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly warning: boolean;
  readonly navigate: () => void;
};
type ObservedThread = ThreadNotificationObservation & {
  readonly raw: OrchestrationV2ThreadShell;
  readonly thread: EnvironmentThreadShell;
  readonly hidden: boolean;
  readonly warning: boolean;
};
type Watched = { readonly stop: () => void; readonly states: Map<ThreadId, ObservedThread> };
const toastListeners = new Set<() => void>();
let notices: readonly Notice[] = [];
let onScreen: string | null = null;
let navigationChanged = () => {};
let observedPaths = new Set<string>();
const pathFor = (environmentId: string, threadId: string) =>
  `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;

export const subscribeLocalNotification = (listener: () => void) => {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
};
export const getLocalNotification = () => notices[0] ?? null;
export function dismissLocalNotification() {
  notices = notices.slice(1);
  for (const listener of toastListeners) listener();
}
export function setLocalNotificationPath(path: string | null) {
  onScreen = path;
  navigationChanged();
}
export function refreshLocalNotifications() {
  navigationChanged();
}
export function locallyObservesNotificationPath(path: string | null) {
  return path !== null && observedPaths.has(path);
}

export function installLocalThreadNotifications(navigate: (path: string) => void): () => void {
  const watched = new Map<EnvironmentId, Watched>();
  let active = true;
  let badge = -1;
  let badgeWrite = Promise.resolve();
  const localDeliveries = new Set<string>();
  const dismissNative = (path: string) => {
    localDeliveries.delete(path);
    void Promise.all([
      Notifications.cancelScheduledNotificationAsync(`local:${path}`),
      Notifications.dismissNotificationAsync(`local:${path}`),
    ]).catch((error: unknown) => console.warn("[notifications] dismissal failed", error));
  };
  const updateBadge = (force = false) => {
    const environments = registry.get(environmentPresentations.presentationsAtom);
    observedPaths = new Set(
      [...watched].flatMap(([environmentId, entry]) =>
        environments.get(environmentId)?.connection.phase === "connected"
          ? [...entry.states.keys()].map((id) => pathFor(environmentId, id))
          : [],
      ),
    );
    const states = [...watched].flatMap(([environmentId, entry]) =>
      [...entry.states.values()].map((state) => ({
        key: pathFor(environmentId, state.thread.id),
        attention: state.attention !== null,
        unread: threadHasUnseenCompletion(state.thread),
        hidden: state.hidden,
      })),
    );
    const next = mobileNotificationBadgeCount(
      states,
      AppState.currentState === "active" ? onScreen : null,
    );
    const visible = new Set(states.filter((state) => !state.hidden).map((state) => state.key));
    const retained = notices.filter((notice) => visible.has(notice.key));
    if (retained.length !== notices.length) {
      notices = retained;
      for (const listener of toastListeners) listener();
    }
    for (const path of localDeliveries) {
      if (!visible.has(path) || (AppState.currentState === "active" && path === onScreen))
        dismissNative(path);
    }
    if (!force && next === badge) return;
    badge = next;
    badgeWrite = badgeWrite
      .then(async () => {
        if (active) await Notifications.setBadgeCountAsync(next);
      })
      .catch((error: unknown) => console.warn("[notifications] badge update failed", error));
  };
  const present = (
    environmentId: EnvironmentId,
    state: ObservedThread,
    kind: ThreadNotificationKind,
  ) => {
    const preferences = AsyncResult.getOrElse(registry.get(mobilePreferencesAtom), () => null);
    const path = pathFor(environmentId, state.thread.id);
    const delivery = mobileNotificationDelivery({
      foreground: AppState.currentState === "active",
      onScreen: path === onScreen,
      inAppEnabled:
        preferences?.inAppNotificationsEnabled ??
        MOBILE_CLIENT_PREFERENCE_DEFAULTS.inAppNotificationsEnabled,
      cloudPush:
        getAgentAwarenessRegistrationStatus() === "registered" &&
        Discovery.relayEnvironmentRegistration(
          registry.get(relayEnvironmentDiscovery.stateValueAtom),
          environmentId,
        ) === "registered",
      suppressed: state.warning && errorsAndWarningsSuppressed(),
    });
    const translator = currentInterfaceTranslator();
    const title = translator.message(
      kind === "completion"
        ? "mobile.insights.notifications.completed"
        : "mobile.insights.notifications.attention",
    );
    if (delivery.toast) {
      notices = [
        ...notices.filter((notice) => notice.key !== path),
        {
          key: path,
          title,
          body: state.thread.title,
          warning: state.warning,
          navigate: () => navigate(path),
        },
      ].slice(-5);
      for (const listener of toastListeners) listener();
    }
    if (delivery.local) {
      void Notifications.getPermissionsAsync()
        .then(async (permission) => {
          if (!active || !permission.granted) return;
          localDeliveries.add(path);
          await Notifications.scheduleNotificationAsync({
            identifier: `local:${path}`,
            content: {
              title,
              body: state.thread.title,
              sound: "default",
              data: {
                deepLink: path,
                environmentId,
                threadId: state.thread.id,
                source: "live-connection",
              },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: "agent-alerts",
            },
          });
        })
        .catch((error: unknown) => console.warn("[notifications] local delivery failed", error));
    }
  };
  const watch = (environmentId: EnvironmentId): Watched => {
    const states = new Map<ThreadId, ObservedThread>();
    const gate = createThreadNotificationGate<ThreadId>((id, kind) => {
      const state = states.get(id);
      if (state) present(environmentId, state, kind);
    });
    let rawThreads: readonly OrchestrationV2ThreadShell[] = [];
    const observe = () => {
      const hidden = registry.get(environmentThreadShells.hiddenThreadKeysAtom);
      const delegated = registry.get(environmentThreadShells.delegatedUnderParentAtom);
      const requests = registry.get(
        environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
      );
      const changes: Array<[ThreadId, ObservedThread | undefined, ObservedThread]> = [];
      const keys = new Set<ThreadId>();
      for (const raw of rawThreads) {
        const prior = states.get(raw.id);
        const request = requests.get(raw.id) ?? null;
        const key = JSON.stringify([environmentId, raw.id]);
        keys.add(raw.id);
        if (
          prior?.raw === raw &&
          (prior.thread.pendingSubagentRequest ?? null) === request &&
          prior.hidden ===
            (prior.thread.archivedAt !== null ||
              hidden.has(key) ||
              isShownUnderParent({ environmentId, threadId: raw.id }, raw.lineage, delegated))
        )
          continue;
        const thread = presentThreadShell(environmentId, raw, request);
        const excluded =
          thread.archivedAt !== null ||
          hidden.has(key) ||
          isShownUnderParent({ environmentId, threadId: raw.id }, raw.lineage, delegated);
        const status = resolveThreadListV2Status(thread);
        const failed =
          status === "failed" ||
          status === "limited" ||
          (status === "ready" && thread.latestRun?.status === "failed");
        const needsInput =
          failed || status === "input" || status === "approval" || status === "request";
        const settled = status === "ready" && thread.latestRun?.status === "completed";
        const at = Date.parse(thread.latestRun?.completedAt ?? "");
        const next: ObservedThread = {
          raw,
          thread,
          hidden: excluded,
          warning: failed,
          attention: needsInput ? `${thread.latestRun?.runId ?? ""}:${status}` : null,
          settled,
          completedAt: settled && Number.isFinite(at) ? at : null,
        };
        states.set(raw.id, next);
        changes.push([raw.id, prior, next]);
      }
      let removed = false;
      for (const id of states.keys())
        if (!keys.has(id)) {
          states.delete(id);
          removed = true;
        }
      gate.retain(keys);
      if (changes.length > 0 || removed) updateBadge();
      for (const [id, prior, next] of changes)
        gate.observe(id, prior, next, {
          archived: next.hidden,
          quiet: next.raw.latestRunStopRequested === true,
        });
    };
    const stopShell = registry.subscribe(
      environmentShell.stateValueAtom(environmentId),
      (shell) => {
        if (shell.status !== "live" || Option.isNone(shell.snapshot)) return;
        rawThreads = shell.snapshot.value.threads;
        observe();
      },
      { immediate: true },
    );
    const stops = [
      stopShell,
      registry.subscribe(
        environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
        observe,
      ),
      registry.subscribe(environmentThreadShells.delegatedUnderParentAtom, observe),
      registry.subscribe(environmentThreadShells.hiddenThreadKeysAtom, observe),
    ];
    return {
      states,
      stop: () => {
        for (const stop of stops) stop();
        gate.clear();
      },
    };
  };
  const sync = () => {
    const environments = registry.get(environmentPresentations.presentationsAtom);
    for (const [id, entry] of watched)
      if (!environments.has(id)) {
        entry.stop();
        watched.delete(id);
      }
    for (const [id] of environments) if (!watched.has(id)) watched.set(id, watch(id));
    updateBadge();
  };
  const cleanNotices = () => {
    const preferences = AsyncResult.getOrElse(registry.get(mobilePreferencesAtom), () => null);
    notices = notices.filter(
      (notice) =>
        notice.key !== onScreen &&
        !(notice.warning && errorsAndWarningsSuppressed()) &&
        (preferences?.inAppNotificationsEnabled ??
          MOBILE_CLIENT_PREFERENCE_DEFAULTS.inAppNotificationsEnabled),
    );
    for (const listener of toastListeners) listener();
    updateBadge(true);
  };
  navigationChanged = cleanNotices;
  const stopEnvironments = registry.subscribe(environmentPresentations.presentationsAtom, sync, {
    immediate: true,
  });
  const stopPreferences = registry.subscribe(mobilePreferencesAtom, cleanNotices);
  const appState = AppState.addEventListener("change", cleanNotices);
  return () => {
    active = false;
    navigationChanged = () => {};
    observedPaths.clear();
    stopEnvironments();
    stopPreferences();
    appState.remove();
    for (const entry of watched.values()) entry.stop();
    notices = [];
    for (const listener of toastListeners) listener();
  };
}
