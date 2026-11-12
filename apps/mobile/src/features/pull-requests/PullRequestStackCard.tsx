import { StackActions, useNavigation } from "@react-navigation/native";
import { useRef, useState } from "react";
import { useAtomRefresh } from "@effect/atom-react";
import type { PullRequestDetail } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Dialog from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { composerPullRequests } from "../../state/pull-requests";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePullRequestPermissions } from "./usePullRequestPermissions";
import { Platform, View } from "react-native";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { AppText as Text } from "../../components/ui/AppText";
import { PullRequestCardGroup, PullRequestCardRow } from "./PullRequestControls";
import { pullRequestLayerParams, pullRequestStackRebase } from "./pullRequestStack";
import { pullRequestStatus } from "./pullRequestStatus";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";
import type { PullRequestStackState } from "./usePullRequestStack";
import { PullRequestGlyph } from "./pullRequestGlyphs";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function PullRequestStackCard(props: {
  readonly params: PullRequestParams;
  readonly state: PullRequestStackState;
  readonly pr?: PullRequestDetail;
}) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const target = pullRequestTarget(props.params);
  const permissions = usePullRequestPermissions(props.params, props.pr ?? null);
  const runAction = useAtomCommand(composerPullRequests.runAction, { reportFailure: false });
  const refreshDetail = useAtomRefresh(composerPullRequests.detail(target));
  const refreshActivity = useAtomRefresh(composerPullRequests.activity(target));
  const stack = props.state.stack;
  const rebase = stack ? pullRequestStackRebase(stack) : null;
  const canRebase =
    props.state.supportsStackActions &&
    permissions.canWrite &&
    props.pr?.viewerPermissions.stackRebase === true;
  const performRebase = async () => {
    const top = rebase?.top;
    if (pending.current || !canRebase || !props.state.isFresh || !rebase?.ready || !top || !stack)
      return;
    pending.current = true;
    setBusy(true);
    await (async () => {
      const result = await runAction({
        ...target,
        input: {
          ...target.input,
          number: top.number,
          action: "update-branch",
          updateMethod: "rebase",
          stackNumber: stack.number,
          expectedStackHeads: rebase.heads,
        },
      });
      if (AsyncResult.isFailure(result))
        Dialog.alert(
          translator.message("mobile.pulls.stack.rebaseFailed"),
          String(squashAtomCommandFailure(result)),
        );
      else Dialog.alert(translator.message("mobile.pulls.stack.rebased"));
    })().finally(() => {
      pending.current = false;
      setBusy(false);
      props.state.refresh();
      refreshDetail();
      refreshActivity();
    });
  };
  if (!stack) {
    const summary =
      props.params.initialSummary?.number === props.params.number
        ? props.params.initialSummary.stack
        : undefined;
    if (!summary) return null;
    return (
      <PullRequestCardGroup>
        <PullRequestCardRow
          title={translator.message("mobile.ui.stack")}
          icon={PullRequestGlyph.stack}
          value={`${summary.position} of ${summary.size}`}
          last
        />
      </PullRequestCardGroup>
    );
  }
  const position = stack.layers.findIndex((layer) => layer.number === props.params.number) + 1;
  return (
    <PullRequestCardGroup>
      <PullRequestCardRow
        title={translator.message("mobile.ui.stack")}
        icon={PullRequestGlyph.stack}
        value={`${position} of ${stack.layers.length}`}
        accessibilityLabel={`Stack, ${position} of ${stack.layers.length}${props.state.isFresh ? "" : ", showing saved stack"}`}
        expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        last={!expanded}
      />
      {expanded ? (
        <View>
          {stack.layers.map((layer, index) => {
            const selected = layer.number === props.params.number;
            const status = pullRequestStatus({
              state: layer.state,
              isDraft: layer.isDraft === true,
            });
            return (
              <View key={layer.number} className={selected ? "bg-thread-selected" : undefined}>
                <PullRequestCardRow
                  title={layer.title ?? layer.headBranch}
                  icon={status.icon}
                  tint={status.tint}
                  value={selected ? "Current" : status.label}
                  detail={`#${layer.number} · ${index + 1} of ${stack.layers.length}`}
                  onPress={
                    selected
                      ? undefined
                      : () => {
                          const params = pullRequestLayerParams(props.params, layer.number);
                          if (Platform.OS === "android")
                            selectDetail({ name: "PullRequest", params });
                          else navigation.dispatch(StackActions.push("PullRequest", params));
                        }
                  }
                  last={index === stack.layers.length - 1}
                />
              </View>
            );
          })}
          <Text className="px-4 py-3 text-xs text-foreground-muted">
            Base: {stack.base}. Open a layer to review it or merge the stack through that layer.
          </Text>
          {canRebase ? (
            <View className="gap-2 px-4 pb-3">
              <Button
                label={translator.message("mobile.pulls.stack.rebase")}
                disabled={busy || !props.state.isFresh || !rebase?.ready}
                loading={busy}
                onPress={() =>
                  Dialog.alert(
                    translator.message("mobile.pulls.stack.rebase"),
                    translator.message("mobile.pulls.stack.rebaseConfirm", {
                      count: rebase?.layers.length ?? 0,
                      base: stack.base,
                    }),
                    [
                      {
                        text: translator.message("mobile.settings.projects.settings.cancel"),
                        style: "cancel",
                      },
                      {
                        text: translator.message("mobile.pulls.stack.rebase"),
                        onPress: () => void performRebase(),
                      },
                    ],
                  )
                }
              />
              {!props.state.isFresh ? (
                <Button
                  tone="text"
                  label={translator.message("mobile.ui.retryStackLookup")}
                  onPress={props.state.refresh}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </PullRequestCardGroup>
  );
}
