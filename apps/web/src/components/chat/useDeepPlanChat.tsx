import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  buildDeepPlanApproveCommand,
  formatDeepPlanMarkdown,
  getDeepPlanApprovalBlockReason,
  isDeepPlanLegacyRun,
} from "@t3tools/client-runtime/deep-planning";
import {
  resolvePlanImplementationSuggestion,
  type PlanImplementationStrategy,
} from "@t3tools/client-runtime/plan-implementation";
import {
  CommandId,
  deriveDeepPlanImplementationThreadId,
  type ComposerMode,
  type DeepPlanSourceRef,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ScopedThreadRef,
  type ServerProvider,
  type StoredDeepPlanRun,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { type ComposerThreadTarget, useComposerDraftStore } from "../../composerDraftStore";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { randomUUID } from "../../lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { ThreadShell } from "../../types";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { DeepPlanChatSourcePicker } from "./DeepPlanSourcePicker";
import { DeepPlanReviewCard } from "./DeepPlanReviewCard";
import { DeepPlanRunControls } from "./DeepPlanRunControls";
import { estimatePlanExecution } from "./planExecutionEstimate";
import { readPromptUltrathink } from "./TraitsPicker";

const NO_SOURCES: readonly DeepPlanSourceRef[] = [];

export function useDeepPlanChat(input: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
  workspaceRoot: string | undefined;
  draftTarget: ComposerThreadTarget;
  mode: ComposerMode;
  run: StoredDeepPlanRun | null;
  threadShells: readonly ThreadShell[];
  supported: boolean;
  connected: boolean;
  canOperate: boolean;
  working: boolean;
  readOnlyReview: boolean;
  providers: ReadonlyArray<ServerProvider>;
  modelSelection: ModelSelection | null;
  getModelSelection: () => ModelSelection | undefined;
}) {
  const navigate = useNavigate();
  const translate = useInterfaceTranslator().message;
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand, {
    reportFailure: false,
  });
  const draftSources = useComposerDraftStore(
    (store) => store.getComposerDraft(input.draftTarget)?.deepPlanSourceRefs ?? NO_SOURCES,
  );
  const draftIncludesProjectChats = useComposerDraftStore(
    (store) => store.getComposerDraft(input.draftTarget)?.deepPlanIncludeProjectChats === true,
  );
  const draftPrompt = useComposerDraftStore(
    (store) => store.getComposerDraft(input.draftTarget)?.prompt ?? "",
  );
  const approvalInFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);

  const run = input.run && !isDeepPlanLegacyRun(input.run) ? input.run : null;
  const frozenRun = run && run.phase !== "completed" && run.phase !== "cancelled" ? run : null;
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.modelSelection?.instanceId,
  );
  const planMarkdown = run?.plan ? formatDeepPlanMarkdown(run.plan) : "";
  const approvalReady =
    !input.readOnlyReview &&
    run?.phase === "awaitingApproval" &&
    run.threadId === input.threadRef.threadId &&
    getDeepPlanApprovalBlockReason(run) === null;
  const suggestion = run?.plan
    ? resolvePlanImplementationSuggestion({
        featureEnabled: true,
        planMarkdown,
        provider,
        deepPlanSteps: run.plan.steps,
      })
    : null;
  const estimate =
    run?.plan && provider && input.modelSelection
      ? estimatePlanExecution({
          planMarkdown,
          modelSelection: input.modelSelection,
          models: provider.models,
          provider: provider.driver,
          ultrathink:
            provider.driver === "claudeAgent" && readPromptUltrathink(draftPrompt) !== "none",
        })
      : undefined;
  const errorScope = JSON.stringify([input.environmentId, input.threadRef.threadId, run?.id]);
  const error = failure?.scope === errorScope ? failure.message : null;
  const canControl = input.connected && input.canOperate && !input.readOnlyReview;
  const canApprove = canControl && input.supported && !input.working;

  async function approve(strategy: PlanImplementationStrategy, inNewThread: boolean) {
    const modelSelection = input.getModelSelection();
    if (!run?.plan || !modelSelection || !canApprove || !approvalReady || approvalInFlight.current)
      return;
    const command = buildDeepPlanApproveCommand({
      run,
      commandId: CommandId.make(randomUUID()),
      operationId: randomUUID(),
      createdAt: new Date().toISOString(),
      implementation: modelSelection,
      implementationThread: inNewThread ? "new" : "current",
      parallelism: strategy.kind === "subagents" ? strategy.count : 1,
    });
    approvalInFlight.current = true;
    setPending(true);
    setFailure(null);
    const result = await dispatch({ environmentId: input.environmentId, input: command });
    approvalInFlight.current = false;
    setPending(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setFailure({
        scope: errorScope,
        message: cause instanceof Error ? cause.message : translate("chat.deepPlan.controlFailed"),
      });
      return;
    }
    useComposerDraftStore.getState().setComposerMode(input.draftTarget, "default");
    if (inNewThread) {
      const target = scopeThreadRef(
        input.environmentId,
        deriveDeepPlanImplementationThreadId(run.id, run.plan.version),
      );
      await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(target) });
    }
  }

  const sourceRefs = frozenRun?.chats ?? draftSources;
  const includeProjectChats = frozenRun?.includeProjectChats ?? draftIncludesProjectChats;
  return {
    implementation:
      approvalReady && canApprove
        ? {
            suggestion,
            pending,
            implement: (strategy: PlanImplementationStrategy, inNewThread: boolean) =>
              void approve(strategy, inNewThread),
          }
        : null,
    sourceRefs,
    includeProjectChats,
    reference: run?.plan ? { runId: run.id, planVersion: run.plan.version } : null,
    content:
      input.mode === "deep-plan" || input.run || input.readOnlyReview ? (
        <>
          {input.mode === "deep-plan" &&
          input.projectId &&
          input.supported &&
          !input.readOnlyReview &&
          !frozenRun &&
          !input.working ? (
            <DeepPlanChatSourcePicker
              currentProject={{ environmentId: input.environmentId, projectId: input.projectId }}
              currentThreadId={input.threadRef.threadId}
              selected={sourceRefs}
              includeProjectChats={includeProjectChats}
              disabled={!canControl || pending}
              onChange={(selected, include) =>
                useComposerDraftStore
                  .getState()
                  .setDeepPlanSourceRefs(input.draftTarget, selected, include)
              }
            />
          ) : null}
          {approvalReady && !input.working ? (
            <ComposerBanner.Attachment>
              <ComposerBanner.Root variant="default">
                <ComposerPlanFollowUpBanner
                  deepPlan
                  planTitle={run?.plan?.goal ?? null}
                  estimate={estimate}
                />
                {error ? (
                  <ComposerBanner.Body>
                    <p role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  </ComposerBanner.Body>
                ) : null}
              </ComposerBanner.Root>
            </ComposerBanner.Attachment>
          ) : null}
          {input.run && !input.readOnlyReview ? (
            <DeepPlanRunControls
              key={`${input.environmentId}:${input.threadRef.threadId}:${input.run.id}`}
              run={input.run}
              threadRef={input.threadRef}
              threadShells={input.threadShells}
              disabled={!canControl || pending}
              supported={input.supported}
            />
          ) : null}
          {input.readOnlyReview ? (
            <ComposerBanner.Root detached>
              <ComposerBanner.Row>
                <ComposerBanner.Content>
                  {translate("chat.deepPlan.reviewReadOnly")}
                </ComposerBanner.Content>
              </ComposerBanner.Row>
            </ComposerBanner.Root>
          ) : null}
        </>
      ) : null,
    review: run?.plan ? (
      <div className="chat-content-lane py-3">
        <DeepPlanReviewCard
          key={`${input.environmentId}:${run.id}:${run.plan.version}`}
          run={run}
          environmentId={input.environmentId}
          threadRef={input.threadRef}
          workspaceRoot={input.workspaceRoot}
        />
      </div>
    ) : null,
  };
}
