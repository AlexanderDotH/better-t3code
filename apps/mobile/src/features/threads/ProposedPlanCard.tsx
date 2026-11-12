import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useEnvironmentScope } from "../../state/session";
import { useSelectedThreadProjection } from "../../state/use-thread-detail";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  approveDeepPlanImplementation,
  buildDeepPlanImplementationPrompt,
  getDeepPlanProposalBlockReason,
  selectDurableDeepPlan,
  formatDeepPlanForDisplay,
} from "@t3tools/client-runtime/deep-planning";
import {
  buildPlanImplementationPrompt,
  resolvePlanImplementationSuggestion,
  type PlanImplementationStrategy,
} from "@t3tools/client-runtime/plan-implementation";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  PlanId,
  ThreadId,
  type OrchestrationV2TurnItem,
  type DeepPlanRun,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { getMobileDeepPlanningApi } from "../../state/deep-planning";
import { useEnvironmentServerConfig, useThreadShell, useThreadShells } from "../../state/entities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import {
  updateComposerDraftSettings,
  setComposerDraftText,
  useComposerDraftSettings,
} from "../../state/use-composer-drafts";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { uuidv4 } from "../../lib/uuid";
import { useMobilePlanParallelismReview } from "./use-plan-parallelism-review";
import { mobilePreferencesAtom } from "../../state/preferences";
import { AsyncResult } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { CopyTextButton } from "./CopyTextButton";
import { ThreadForkButton } from "./ThreadForkButton";
import { useThreadForkAction } from "./use-thread-fork-action";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { DeepPlanChecklist } from "./DeepPlanChecklist";
import { sharePlanMarkdown } from "./share-plan-markdown";
import { buildCollapsedProposedPlanPreviewMarkdown } from "@t3tools/client-runtime/proposed-plan";
import { stashComposerDraft } from "../../state/composer-library";

export function ProposedPlanCard(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null | undefined;
  readonly markdown: string;
  readonly plan: Pick<
    Extract<OrchestrationV2TurnItem, { readonly type: "proposed_plan" }>,
    "threadId" | "planId" | "updatedAt" | "deepPlan"
  >;
  readonly deepPlan?: DeepPlanRun | null;
  readonly onActionComplete?: () => void;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(props.environmentId);
  const thread = useThreadShell(scopeThreadRef(props.environmentId, props.plan.threadId));
  const draftSettings = useComposerDraftSettings(
    thread ? scopedThreadKey(props.environmentId, thread.id) : null,
  );
  const implementationModel = draftSettings.modelSelection ?? thread?.modelSelection;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const projection = useSelectedThreadProjection();
  const threadShells = useThreadShells();
  const durableRun = props.deepPlan ?? selectDurableDeepPlan(thread, threadShells);
  const deepPlanReference =
    props.plan.deepPlan ??
    projection?.projection.plans.find((plan) => plan.id === props.plan.planId)?.deepPlan;
  const fullMarkdown =
    deepPlanReference && durableRun?.plan
      ? formatDeepPlanForDisplay(durableRun, translator)
      : props.markdown;
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const forkAction = useThreadForkAction({
    environmentId: props.environmentId,
    threadId: props.plan.threadId,
  });
  const canRefine = thread !== null && canOperate && !threadRuntimeIsActive(thread.runtime);
  const available =
    canRefine &&
    getDeepPlanProposalBlockReason({ deepPlan: deepPlanReference }, durableRun) === null;
  const parallelEnabled =
    AsyncResult.isSuccess(preferences) &&
    preferences.value.experimentalParallelPlanImplementation === true;
  const implementationProvider =
    config?.providers.find((provider) => provider.instanceId === implementationModel?.instanceId) ??
    null;
  const review = useMobilePlanParallelismReview({
    enabled: parallelEnabled,
    environmentId: props.environmentId,
    threadId: props.plan.threadId,
    plan: {
      id: PlanId.make(props.plan.planId),
      updatedAt: DateTime.formatIso(props.plan.updatedAt),
      planMarkdown: fullMarkdown,
      implementedAt: null,
      ...(deepPlanReference ? { deepPlan: deepPlanReference } : {}),
    },
    deepPlanRun: durableRun,
    implementationProvider,
    reviewerSelection: config?.settings.parallelPlanReviewModelSelection ?? null,
    providers: config?.providers ?? [],
  });
  const suggestedParallelism =
    resolvePlanImplementationSuggestion({
      featureEnabled: parallelEnabled,
      planMarkdown: fullMarkdown,
      provider: implementationProvider,
      reviewedSubagentCount: review.reviewedSubagentCount,
    })?.strategy.count ?? 0;
  const [implementing, setImplementing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapsible = props.markdown.length > 2_400 || props.markdown.split("\n").length > 40;
  const implementationPending = useRef(false);
  const implement = async (
    newThread: boolean,
    strategy: PlanImplementationStrategy = { kind: "standard" },
  ) => {
    if (
      !available ||
      !thread ||
      !config ||
      implementationPending.current ||
      review.status === "reviewing"
    )
      return;
    implementationPending.current = true;
    setImplementing(true);
    await Promise.resolve()
      .then(async () => {
        const metadata = makeQueuedMessageMetadata();
        const targetThreadId = newThread ? ThreadId.make(uuidv4()) : thread.id;
        let text = buildPlanImplementationPrompt(props.markdown, {
          strategy,
          provider: implementationProvider ?? undefined,
        });
        let deepPlan;
        if (deepPlanReference) {
          const api = getMobileDeepPlanningApi(props.environmentId);
          const run = await api.getRun({
            threadId: durableRun?.threadId ?? props.plan.threadId,
            runId: deepPlanReference.runId,
          });
          if (!run)
            throw new Error("The Deep Plan is unavailable. Refresh the thread and try again.");
          const reason = getDeepPlanProposalBlockReason({ deepPlan: deepPlanReference }, run);
          if (reason) throw new Error(reason);
          const approved = await approveDeepPlanImplementation({
            run,
            implementation: implementationModel ?? thread.modelSelection,
            implementationThreadId: targetThreadId,
            requestedParallelism: strategy.kind === "subagents" ? strategy.count : 1,
            commandId: CommandId.make(`${metadata.commandId}:approve`),
            operationId: uuidv4(),
            createdAt: metadata.createdAt,
            getRun: api.getRun,
            dispatchCommand: api.dispatchCommand,
          });
          text = buildDeepPlanImplementationPrompt(approved, {
            strategy,
            provider: implementationProvider ?? undefined,
          });
          deepPlan = deepPlanReference;
        }
        await enqueueThreadOutboxMessage({
          environmentId: props.environmentId,
          threadId: targetThreadId,
          commandId: CommandId.make(metadata.commandId),
          messageId: MessageId.make(metadata.messageId),
          text,
          attachments: [],
          createdAt: metadata.createdAt,
          modelSelection: implementationModel ?? thread.modelSelection,
          runtimeMode: draftSettings.runtimeMode ?? thread.runtimeMode,
          interactionMode: "default",
          composerMode: "default",
          sourceProposedPlan: {
            threadId: props.plan.threadId,
            planId: PlanId.make(props.plan.planId),
            ...(deepPlan ? { deepPlan } : {}),
          },
          ...(newThread
            ? {
                creation: {
                  projectId: thread.projectId,
                  projectCwd: props.workspaceRoot ?? undefined,
                  workspaceMode: "local",
                  branch: thread.branch,
                  worktreePath: thread.worktreePath,
                },
              }
            : {}),
        });
        props.onActionComplete?.();
        if (newThread)
          navigation.dispatch(
            StackActions.push("Thread", {
              environmentId: String(props.environmentId),
              threadId: String(targetThreadId),
            }),
          );
      })
      .catch((error: unknown) => {
        Dialog.alert(
          translator.message("mobile.ui.couldNotImplementPlan"),
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        implementationPending.current = false;
        setImplementing(false);
      });
  };
  const refine = () => {
    if (!thread) return;
    const key = scopedThreadKey(props.environmentId, thread.id);
    stashComposerDraft(key, props.environmentId);
    updateComposerDraftSettings(key, {
      composerMode: deepPlanReference ? "deep-plan" : "plan",
      interactionMode: "plan",
    });
    setComposerDraftText(key, "Revise this plan: ");
    props.onActionComplete?.();
    if (projection?.projection.thread.id !== thread.id)
      navigation.dispatch(
        StackActions.push("Thread", {
          environmentId: String(props.environmentId),
          threadId: String(thread.id),
        }),
      );
  };
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(props.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [lastPath, setLastPath] = useState("plan.md");
  const contents = `${fullMarkdown.trimEnd()}\n`;

  const save = async (path: string) => {
    const relativePath = path.trim();
    if (!canWrite || !props.workspaceRoot || inFlight.current) return;
    if (!relativePath) {
      Dialog.alert(translator.message("chat.plan.enterWorkspacePath"));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setLastPath(relativePath);
    const result = await writeFile({
      environmentId: props.environmentId,
      input: { cwd: props.workspaceRoot, relativePath, contents },
    }).finally(() => {
      inFlight.current = false;
      setSaving(false);
    });
    if (result._tag === "Success") {
      Dialog.alert(translator.message("chat.plan.saved"), result.value.relativePath);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        translator.message("chat.plan.saveFailed"),
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="flex-row items-center gap-2">
        <Text accessibilityRole="header" className="flex-1 font-t3-bold text-base text-foreground">
          {proposedPlanTitle(props.markdown) ?? translator.message("mobile.subagent.proposedPlan")}
        </Text>
        <CopyTextButton
          accessibilityLabel={translator.message("mobile.ui.copyPlan")}
          text={contents}
        />
        {forkAction && !props.deepPlan ? (
          <ThreadForkButton
            boundary={{ kind: "proposed-plan", planId: PlanId.make(props.plan.planId) }}
            action={forkAction}
            buttonSize={28}
            iconSize={13}
          />
        ) : null}
      </View>
      {props.renderMarkdown(
        collapsible && !expanded
          ? buildCollapsedProposedPlanPreviewMarkdown(props.markdown)
          : stripDisplayedPlanMarkdown(props.markdown),
      )}
      {collapsible ? (
        <Button
          label={translator.message(
            expanded ? "mobile.composer.collapsePlan" : "mobile.composer.expandPlan",
          )}
          tone="text"
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
      {deepPlanReference && durableRun ? (
        <DeepPlanChecklist embedded environmentId={props.environmentId} run={durableRun} />
      ) : null}
      {review.status === "reviewing" ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          {translator.message("chat.composer.analyzingPlan")}
        </Text>
      ) : review.status === "fallback" ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("chat.composer.planReviewFallback")}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={
            implementing
              ? translator.message("mobile.ui.starting")
              : translator.message("mobile.thread.implement")
          }
          disabled={!available || implementing || review.status === "reviewing"}
          onPress={() => void implement(false)}
        />
        <Button
          label={translator.message("chat.composer.implementNewThread")}
          tone="secondary"
          disabled={!available || implementing || review.status === "reviewing"}
          onPress={() => void implement(true)}
        />
        {parallelEnabled && suggestedParallelism >= 2 ? (
          <Button
            label={translator.message("mobile.composer.useAgents", { count: suggestedParallelism })}
            tone={deepPlanReference ? "deep-plan" : "secondary"}
            disabled={!available || implementing || review.status === "reviewing"}
            onPress={() =>
              void implement(false, { kind: "subagents", count: suggestedParallelism })
            }
          />
        ) : null}
        {parallelEnabled && suggestedParallelism >= 2 ? (
          <Button
            label={translator.message("mobile.composer.parallelNewThread", {
              count: suggestedParallelism,
            })}
            tone={deepPlanReference ? "deep-plan" : "secondary"}
            disabled={!available || implementing || review.status === "reviewing"}
            onPress={() => void implement(true, { kind: "subagents", count: suggestedParallelism })}
          />
        ) : null}
        <Button
          label={translator.message("mobile.composer.sharePlan")}
          tone="secondary"
          onPress={() =>
            void sharePlanMarkdown(contents).catch((error: unknown) =>
              Dialog.alert(
                translator.message("mobile.composer.shareFailed"),
                error instanceof Error ? error.message : String(error),
              ),
            )
          }
        />
        <Button
          label={translator.message("chat.composer.refine")}
          tone="secondary"
          disabled={!canRefine || implementing}
          onPress={refine}
        />

        <Button
          label={
            saving
              ? translator.message("mobile.ui.saving")
              : translator.message("chat.plan.saveWorkspace")
          }
          tone="secondary"
          disabled={!canWrite || !props.workspaceRoot || saving}
          onPress={() =>
            Dialog.prompt({
              title: translator.message("chat.plan.saveTitle"),
              // The write replaces an existing file, and the RPC has no create-only mode.
              message: translator.message("mobile.ui.enterAPathRelativeToTheThreads"),
              initialValue: lastPath,
              confirmText: translator.message("mobile.connection.save"),
              onConfirm: (path) => void save(path),
            })
          }
        />
      </View>
    </View>
  );
}
