import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { useEnvironmentScope } from "../../state/session";
import { useSelectedThreadProjection } from "../../state/use-thread-detail";
import { StackActions, useNavigation } from "@react-navigation/native";
import {
  approveDeepPlanImplementation,
  buildDeepPlanImplementationPrompt,
  getDeepPlanApprovalBlockReason,
} from "@t3tools/client-runtime/deep-planning";
import {
  buildPlanImplementationPrompt,
  type PlanImplementationStrategy,
} from "@t3tools/client-runtime/plan-implementation";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  PlanId,
  ThreadId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { getMobileDeepPlanningApi } from "../../state/deep-planning";
import { useEnvironmentServerConfig, useThreadShell } from "../../state/entities";
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

export function ProposedPlanCard(props: {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null | undefined;
  readonly markdown: string;
  readonly plan: Extract<OrchestrationV2TurnItem, { readonly type: "proposed_plan" }>;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(props.environmentId);
  const thread = useThreadShell(scopeThreadRef(props.environmentId, props.plan.threadId));
  const draftSettings = useComposerDraftSettings(
    thread ? scopedThreadKey(props.environmentId, thread.id) : null,
  );
  const implementationModel = draftSettings.modelSelection ?? thread?.modelSelection;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const projection = useSelectedThreadProjection();
  const deepPlanReference =
    props.plan.deepPlan ??
    projection?.projection.plans.find((plan) => plan.id === props.plan.planId)?.deepPlan;
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const forkAction = useThreadForkAction({
    environmentId: props.environmentId,
    threadId: props.plan.threadId,
  });
  const available = thread !== null && canOperate && !threadRuntimeIsActive(thread.runtime);
  const parallelEnabled =
    AsyncResult.isSuccess(preferences) &&
    preferences.value.experimentalParallelPlanImplementation === true;
  const implementationProvider =
    config?.providers.find((provider) => provider.instanceId === implementationModel?.instanceId) ??
    null;
  const reviewedCount = useMobilePlanParallelismReview({
    enabled: parallelEnabled,
    environmentId: props.environmentId,
    threadId: props.plan.threadId,
    plan: {
      id: PlanId.make(props.plan.planId),
      updatedAt: DateTime.formatIso(props.plan.updatedAt),
      planMarkdown: props.markdown,
      implementedAt: null,
    },
    implementationProvider,
    reviewerSelection: config?.settings.parallelPlanReviewModelSelection ?? null,
    providers: config?.providers ?? [],
  });
  const suggestedParallelism =
    reviewedCount ??
    Math.min(2, implementationProvider?.nativeSubagents?.maxRecommendedSubagents ?? 0);
  const [implementing, setImplementing] = useState(false);
  const implementationPending = useRef(false);
  const implement = async (
    newThread: boolean,
    strategy: PlanImplementationStrategy = { kind: "standard" },
  ) => {
    if (!available || !thread || !config || implementationPending.current) return;
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
            threadId: props.plan.threadId,
            runId: deepPlanReference.runId,
          });
          if (!run)
            throw new Error("The Deep Plan is unavailable. Refresh the thread and try again.");
          const reason = getDeepPlanApprovalBlockReason(run);
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
          "Could not implement plan",
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
    updateComposerDraftSettings(key, {
      composerMode: deepPlanReference ? "deep-plan" : "plan",
      interactionMode: "plan",
    });
    setComposerDraftText(key, "Revise this plan: ");
  };
  const canWrite = useAtomValue(projectEnvironment.writeFile.permissionAtom(props.environmentId));
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [lastPath, setLastPath] = useState("plan.md");
  const contents = `${props.markdown.trimEnd()}\n`;

  const save = async (path: string) => {
    const relativePath = path.trim();
    if (!canWrite || !props.workspaceRoot || inFlight.current) return;
    if (!relativePath) {
      Dialog.alert("Enter a workspace path");
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
      Dialog.alert("Plan saved to workspace", result.value.relativePath);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert("Could not save plan", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="flex-row items-center gap-2">
        <Text accessibilityRole="header" className="flex-1 font-t3-bold text-base text-foreground">
          {proposedPlanTitle(props.markdown) ?? "Proposed plan"}
        </Text>
        <CopyTextButton accessibilityLabel="Copy plan" text={contents} />
        {forkAction ? (
          <ThreadForkButton
            boundary={{ kind: "proposed-plan", planId: PlanId.make(props.plan.planId) }}
            action={forkAction}
            buttonSize={28}
            iconSize={13}
          />
        ) : null}
      </View>
      {props.renderMarkdown(stripDisplayedPlanMarkdown(props.markdown))}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={implementing ? "Starting..." : "Implement"}
          disabled={!available || implementing}
          onPress={() => void implement(false)}
        />
        <Button
          label="New thread"
          tone="secondary"
          disabled={!available || implementing}
          onPress={() => void implement(true)}
        />
        {parallelEnabled && suggestedParallelism >= 2 ? (
          <Button
            label={`Use ${suggestedParallelism} agents`}
            tone="secondary"
            disabled={!available || implementing}
            onPress={() =>
              void implement(false, { kind: "subagents", count: suggestedParallelism })
            }
          />
        ) : null}
        <Button
          label="Refine"
          tone="secondary"
          disabled={!available || implementing}
          onPress={refine}
        />

        <Button
          label={saving ? "Saving..." : "Save to workspace"}
          tone="secondary"
          disabled={!canWrite || !props.workspaceRoot || saving}
          onPress={() =>
            Dialog.prompt({
              title: "Save plan to workspace",
              // The write replaces an existing file, and the RPC has no create-only mode.
              message:
                "Enter a path relative to the thread's workspace. A file already at that path is replaced.",
              initialValue: lastPath,
              confirmText: "Save",
              onConfirm: (path) => void save(path),
            })
          }
        />
      </View>
    </View>
  );
}
