import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePullRequestConnected } from "../usePullRequestConnected";
import { composerPullRequests } from "../../../state/pull-requests";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { pullRequestTarget, type PullRequestParams } from "../usePullRequestDiff";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { showReviewGuide, watchReviewGuideRun } from "./reviewGuideRuns";

export function useReviewGuidesEnabled(params: PullRequestParams) {
  const settings = useAtomValue(
    serverEnvironment.settingsValueAtom(pullRequestTarget(params).environmentId),
  );
  return settings?.reviewGuidesEnabled === true;
}

export function useReviewGuide(params: PullRequestParams, visible = true) {
  const translator = useMobileInterfaceTranslator();
  const target = pullRequestTarget(params);
  const enabled = useReviewGuidesEnabled(params);
  const query = useEnvironmentQuery(enabled ? composerPullRequests.reviewGuide(target) : null);
  const connected = usePullRequestConnected(target.environmentId);
  const permitted = useAtomValue(
    composerPullRequests.generateReviewGuide.permissionAtom(target.environmentId),
  );
  const canWrite = connected && permitted;
  const generate = useAtomCommand(composerPullRequests.generateReviewGuide, {
    reportFailure: false,
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const running = starting || query.data?.run?._tag === "Running";
  const refresh = query.refresh;
  const notificationParams = useMemo(
    () => ({
      environmentId: params.environmentId,
      projectId: params.projectId,
      repository: params.repository,
      number: params.number,
      host: params.host,
    }),
    [params.environmentId, params.host, params.number, params.projectId, params.repository],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers server-observed runs with the app-lifetime notification watcher
  useEffect(() => {
    if (enabled && query.data?.run?._tag === "Running")
      watchReviewGuideRun(notificationParams, query.data, true);
  }, [enabled, notificationParams, query.data]);
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !visible) return;
      const hide = showReviewGuide(notificationParams);
      refresh();
      return hide;
    }, [enabled, notificationParams, refresh, visible]),
  );
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !visible || !running) return;
      const timer = setInterval(refresh, 5_000);
      return () => clearInterval(timer);
    }, [enabled, refresh, running, visible]),
  );
  const write = async () => {
    if (!enabled || !canWrite || running || pending.current) return;
    pending.current = true;
    setStarting(true);
    setError(null);
    const result = await generate(target);
    pending.current = false;
    setStarting(false);
    if (AsyncResult.isFailure(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : translator.message("mobile.ui.couldNotStartTheReviewGuide"),
      );
    } else if (AsyncResult.isSuccess(result))
      watchReviewGuideRun(notificationParams, query.data, result.value?.run?._tag === "Running");
  };
  return { ...query, enabled, canWrite, running, write, startError: error };
}
