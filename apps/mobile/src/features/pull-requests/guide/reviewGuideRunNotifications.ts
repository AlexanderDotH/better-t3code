import { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import { selectWorkspaceDetail } from "../../workspace/workspace-detail-selection";
import { rootNavigationRef, whenRootNavigationReady } from "../../../lib/rootNavigation";
import { appAtomRegistry as registry } from "../../../state/atom-registry";
import { composerPullRequests } from "../../../state/pull-requests";
import { mobilePreferencesAtom } from "../../../state/preferences";
import { workspaceConnections } from "../../../state/workspace";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../../persistence/mobile-preferences";
import { currentInterfaceTranslator } from "../../../localization/currentInterfaceTranslator";
import { pullRequestTarget } from "../usePullRequestDiff";
import {
  guideRunWatchesAtom,
  isReviewGuideShown,
  settleReviewGuideRun,
  type GuideRunWatch,
} from "./reviewGuideRuns";
import { reviewGuideRunOutcome } from "./reviewGuideRunOutcome";

const GuideNotificationTarget = Schema.Struct({
  ...PullRequestRef.fields,
  environmentId: EnvironmentId,
  source: Schema.Literal("review-guide"),
  headSha: Schema.optional(Schema.String),
  generatedAt: Schema.optional(Schema.String),
});
type GuideNotificationTarget = typeof GuideNotificationTarget.Type;
const decodeTarget = Schema.decodeUnknownOption(GuideNotificationTarget);
export type GuideRunNotice = {
  readonly key: string;
  readonly target: GuideNotificationTarget;
  readonly title: string;
  readonly body: string;
  readonly failed: boolean;
};
export const guideRunNoticesAtom = Atom.make<readonly GuideRunNotice[]>([]).pipe(Atom.keepAlive);
export const dismissGuideRunNotice = () =>
  registry.update(guideRunNoticesAtom, (current) => current.slice(1));

export function openGuideRunNotice(target: GuideNotificationTarget) {
  whenRootNavigationReady(() => {
    const params = {
      ...target,
      environmentId: String(target.environmentId),
      projectId: String(target.projectId),
    };
    if (target.headSha && target.generatedAt)
      rootNavigationRef.navigate("PullRequestGuideStop", {
        ...params,
        position: 0,
        guideHeadSha: target.headSha,
        guideGeneratedAt: target.generatedAt,
      });
    else rootNavigationRef.dispatch(selectWorkspaceDetail({ name: "PullRequest", params }));
  });
}

export function installReviewGuideRunNotifications() {
  const running = new Map<string, () => void>();
  let disposed = false;
  const present = (notice: GuideRunNotice) => {
    if (AppState.currentState === "active" && isReviewGuideShown(notice.key)) return;
    const preferences = AsyncResult.getOrElse(registry.get(mobilePreferencesAtom), () => null);
    if (AppState.currentState === "active") {
      if (
        preferences?.inAppNotificationsEnabled ??
        MOBILE_CLIENT_PREFERENCE_DEFAULTS.inAppNotificationsEnabled
      )
        registry.update(guideRunNoticesAtom, (current) =>
          [...current.filter((item) => item.key !== notice.key), notice].slice(-5),
        );
      return;
    }
    void Notifications.getPermissionsAsync()
      .then(async (permission) => {
        if (disposed || !permission.granted) return;
        await Notifications.scheduleNotificationAsync({
          identifier: `guide:${notice.key}`,
          content: {
            title: notice.title,
            body: notice.body,
            sound: "default",
            data: notice.target,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
            channelId: "agent-alerts",
          },
        });
      })
      .catch((error: unknown) => console.warn("[review-guide] notification failed", error));
  };
  const watch = (key: string, entry: GuideRunWatch) => {
    const target = pullRequestTarget(entry.params);
    const atom = composerPullRequests.reviewGuide(target);
    let sawRunning = entry.answeredRunning;
    let subscribing = true;
    const unsubscribe = registry.subscribe(
      atom,
      (result) => {
        if (
          !AsyncResult.isSuccess(result) ||
          result.waiting ||
          (subscribing && entry.answeredRunning)
        )
          return;
        const outcome = reviewGuideRunOutcome(result.value, entry, sawRunning, Date.now());
        if (outcome.kind === "running") {
          sawRunning = true;
          return;
        }
        if (outcome.kind === "waiting") return;
        settleReviewGuideRun(key);
        if (outcome.kind === "settled") return;
        const translator = currentInterfaceTranslator();
        present({
          key,
          failed: outcome.kind === "failed",
          title: translator.message(
            outcome.kind === "ready" ? "mobile.pulls.guide.ready" : "mobile.pulls.guide.failed",
          ),
          body: `${entry.params.repository} #${entry.params.number}${outcome.kind === "failed" ? `: ${outcome.detail}` : ""}`,
          target: {
            ...target.input,
            environmentId: target.environmentId,
            source: "review-guide",
            ...(outcome.kind === "ready" && outcome.guide.stops.length
              ? { headSha: outcome.guide.headSha, generatedAt: outcome.guide.generatedAt }
              : {}),
          },
        });
      },
      { immediate: true },
    );
    subscribing = false;
    const refresh = () => {
      if (AppState.currentState === "active" && isReviewGuideShown(key)) return;
      if (
        registry
          .get(workspaceConnections.environmentsAtom)
          .some(
            (environment) =>
              environment.environmentId === target.environmentId &&
              environment.connectionState === "connected",
          )
      )
        registry.refresh(atom);
    };
    const timer = setInterval(refresh, 5_000);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    refresh();
    return () => {
      unsubscribe();
      clearInterval(timer);
      appState.remove();
    };
  };
  const stopWatches = registry.subscribe(
    guideRunWatchesAtom,
    (watches) => {
      for (const [key, stop] of running)
        if (!watches[key]) {
          running.delete(key);
          stop();
        }
      for (const [key, entry] of Object.entries(watches)) {
        if (running.has(key)) continue;
        const stop = watch(key, entry);
        if (registry.get(guideRunWatchesAtom)[key] === entry) running.set(key, stop);
        else stop();
      }
    },
    { immediate: true },
  );
  const handled = new Set<string>();
  const onResponse = (response: Notifications.NotificationResponse) => {
    if (handled.has(response.notification.request.identifier)) return;
    const target = decodeTarget(response.notification.request.content.data);
    if (Option.isNone(target)) return;
    handled.add(response.notification.request.identifier);
    openGuideRunNotice(target.value);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(onResponse);
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!disposed && response) onResponse(response);
    })
    .catch((error: unknown) => console.warn("[review-guide] notification response failed", error));
  return () => {
    disposed = true;
    stopWatches();
    subscription.remove();
    for (const stop of running.values()) stop();
    running.clear();
  };
}
