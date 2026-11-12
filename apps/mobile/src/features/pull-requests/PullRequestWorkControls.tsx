import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type PullRequestDetail } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { gitEnvironment } from "../../state/git";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentScope } from "../../state/session";
import {
  createNewTaskDraft,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { usePullRequestActingEnvironment } from "./usePullRequestActingEnvironment";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";

export function PullRequestWorkControls(props: {
  readonly params: PullRequestParams;
  readonly pr: PullRequestDetail;
}) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const work = usePullRequestActingEnvironment(props.params);
  const target = pullRequestTarget(work.params);
  const canCheckout = useAtomValue(
    gitEnvironment.preparePullRequestThread.permissionAtom(target.environmentId),
  );
  const canOperate = useEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope);
  const prepare = useAtomCommand(gitEnvironment.preparePullRequestThread, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const checkout = async (mode: "local" | "worktree") => {
    const acting = work.acting;
    if (
      pending.current ||
      !acting?.connected ||
      !canCheckout ||
      (mode === "worktree" && !canOperate)
    )
      return;
    pending.current = true;
    setBusy(true);
    return await (async () => {
      const result = await prepare({
        environmentId: target.environmentId,
        input: {
          cwd: acting.project.workspaceRoot,
          reference: props.pr.url,
          mode,
        },
      });
      if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
      if (!AsyncResult.isSuccess(result)) return;
      if (!result.value.isOnPullRequestHead) {
        Dialog.alert(translator.message("mobile.pulls.checkout.offHead"));
        return;
      }
      if (mode === "worktree") {
        await waitForComposerDraftsLoaded();
        const draftId = createNewTaskDraft({
          environmentId: target.environmentId,
          projectId: target.input.projectId,
        });
        updateComposerDraftSettings(draftId, {
          workspaceSelection: {
            mode: "local",
            branch: result.value.branch,
            worktreePath: result.value.worktreePath,
            startFromOrigin: false,
          },
        });
        const params = { draft: { draftId, title: `#${props.pr.number} · ${props.pr.title}` } };
        if (Platform.OS === "android") selectDetail({ name: "Thread", params });
        else navigation.dispatch(StackActions.push("Thread", params));
      } else
        Dialog.alert(
          translator.message("mobile.pulls.checkout.ready"),
          `${result.value.branch}\n${acting.project.workspaceRoot}`,
        );
    })()
      .catch((error) => {
        Dialog.alert(
          translator.message("mobile.pulls.checkout.failed"),
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };
  return (
    <View className="gap-2">
      {work.choices.length ? (
        <Menu
          title={translator.message("mobile.pulls.work.environment", {
            environment: work.acting?.label ?? "",
          })}
          actions={work.choices.map((choice) => ({
            id: choice.environmentId,
            title: choice.label,
            state:
              choice.environmentId === work.acting?.environmentId
                ? ("on" as const)
                : ("off" as const),
            attributes: { disabled: busy || !choice.connected },
          }))}
          onPressAction={({ nativeEvent }) => {
            const choice = work.choices.find((item) => item.environmentId === nativeEvent.event);
            if (choice && !busy) work.select(choice.environmentId);
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            className="min-h-11 justify-center self-start py-2"
          >
            <Text className="text-sm text-primary-text">
              {translator.message("mobile.pulls.work.environment", {
                environment: work.acting?.label ?? "",
              })}
            </Text>
          </Pressable>
        </Menu>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={translator.message("mobile.pulls.checkout.here")}
          disabled={busy || !canCheckout || !work.acting?.connected}
          loading={busy}
          onPress={() => {
            if (work.acting)
              Dialog.alert(
                translator.message("mobile.pulls.checkout.here"),
                translator.message("mobile.pulls.checkout.confirm", {
                  path: work.acting.project.workspaceRoot,
                  environment: work.acting.label,
                }),
                [
                  {
                    text: translator.message("mobile.settings.projects.settings.cancel"),
                    style: "cancel",
                  },
                  {
                    text: translator.message("mobile.pulls.checkout.here"),
                    onPress: () => void checkout("local"),
                  },
                ],
              );
          }}
        />
        <Button
          label={translator.message("mobile.pulls.checkout.worktree")}
          disabled={busy || !canCheckout || !canOperate || !work.acting?.connected}
          onPress={() => void checkout("worktree")}
        />
      </View>
      {busy ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("mobile.ui.working")}
        </Text>
      ) : null}
    </View>
  );
}
