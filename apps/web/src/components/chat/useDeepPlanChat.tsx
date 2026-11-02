import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { waitForStartedServerThread } from "../ChatView.logic";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { getSupportedPlanSubagentCounts } from "@t3tools/client-runtime/plan-implementation";
import { Menu, MenuTrigger, MenuPopup, MenuRadioGroup, MenuRadioItem } from "../ui/menu";
import { useState } from "react";
import type {
  ComposerMode,
  DeepPlanRun,
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProjectId,
  RunId,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import {
  buildDeepPlanImplementationPrompt,
  continueDeepPlanForTurn,
  getDeepPlanApprovalBlockReason,
} from "@t3tools/client-runtime/deep-planning";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useDeepPlanSources } from "../../hooks/useDeepPlanSources";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { approveWebDeepPlan, getWebDeepPlanningApi } from "../../state/deepPlanning";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { newMessageId, newThreadId, randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { DeepPlanSourcePicker } from "./DeepPlanSourcePicker";
import { DeepPlanAnalysisProgress } from "./DeepPlanProgress";
import { DeepPlanReviewCard } from "./DeepPlanReviewCard";
import { DeepPlanRunControls } from "./DeepPlanRunControls";

const NO_SOURCES: ReadonlyArray<import("@t3tools/contracts").DeepPlanSourceRef> = [];

export function useDeepPlanChat(input: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
  workspaceRoot: string | undefined;
  branch: string | null;
  worktreePath: string | null;
  draftTarget: ComposerThreadTarget;
  mode: ComposerMode;
  run: DeepPlanRun | null;
  supported: boolean;
  parallelEnabled: boolean;
  connected: boolean;
  canOperate: boolean;
  working: boolean;
  latestRunId: RunId | null;
  latestUserMessageId: MessageId | null;
  runtimeMode: RuntimeMode;
  providers: ReadonlyArray<ServerProvider>;
  modelSelection: ModelSelection | null;
  getModelSelection: () => ModelSelection | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const navigate = useNavigate();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const sources = useComposerDraftStore(
    (store) => store.getComposerDraft(input.draftTarget)?.deepPlanSourceRefs ?? NO_SOURCES,
  );
  const currentProject = input.projectId
    ? { environmentId: input.environmentId, projectId: input.projectId }
    : null;
  const frozen = input.run !== null && input.run.phase !== "completed";
  const capturedSources = frozen && input.run?.sources.length ? input.run.sources : null;
  const sourceOptions = capturedSources?.map((source) => ({
    ref: source.origin,
    environmentLabel:
      source.environmentLabel ??
      environments.find((environment) => environment.environmentId === source.origin.environmentId)
        ?.label ??
      String(source.origin.environmentId),
    projectTitle: source.projectTitle,
    title: source.threadTitle,
    archived: source.archived,
    available: true,
  }));
  const selectedSources = capturedSources
    ? capturedSources.map((source) => source.origin)
    : sources;

  const catalog = useDeepPlanSources({
    enabled: input.mode === "deep-plan" && input.supported && !frozen,
    currentProject,
    projects,
    environments,
  });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete, { reportFailure: false });
  const [parallelism, setParallelism] = useState(1);
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.modelSelection?.instanceId,
  );
  const supportedCounts = input.parallelEnabled ? getSupportedPlanSubagentCounts(provider) : [];
  const requestedParallelism = supportedCounts.includes(parallelism) ? parallelism : 1;
  const [pending, setPending] = useState(false);
  const errorScope = JSON.stringify([input.environmentId, input.threadRef.threadId, input.run?.id]);
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const error = errorState?.scope === errorScope ? errorState.message : null;
  const setError = (message: string | null) =>
    setErrorState(message === null ? null : { scope: errorScope, message });
  const implementationThreadId = input.run?.approval?.implementationThreadId;

  const ownsContinuation =
    !input.run?.approval || input.run.approval.implementationThreadId === input.threadRef.threadId;
  const disabled =
    !input.canOperate || !input.connected || input.working || pending || !ownsContinuation;
  const continueRun = async (automatic = false) => {
    const run = input.run;
    const modelSelection = input.getModelSelection();
    if (!run || !input.projectId || !modelSelection || disabled) return;
    await continueDeepPlanForTurn({
      run,
      automatic,
      threadId: input.threadRef.threadId,
      idleGuard: { latestRunId: input.latestRunId, latestUserMessageId: input.latestUserMessageId },
      environmentId: input.environmentId,
      projectId: input.projectId,
      fallbackModelSelection: modelSelection,
      runtimeMode: input.runtimeMode,
      providers: input.providers,
      apiForEnvironment: getWebDeepPlanningApi,
      createId: randomUUID,
    });
  };
  const approve = async (inNewThread = false) => {
    const run = input.run;
    const modelSelection = input.getModelSelection();
    if (!run || !modelSelection || disabled) return;
    const targetThreadId = inNewThread ? newThreadId() : input.threadRef.threadId;
    let created = false;
    let approved: DeepPlanRun | null = null;
    setPending(true);
    setError(null);
    const outcome = await settlePromise(async () => {
      if (inNewThread) {
        if (!input.projectId) return;
        const result = await createThread({
          environmentId: input.environmentId,
          input: {
            threadId: targetThreadId,
            projectId: input.projectId,
            title: run.plan?.goal ?? "DeepPlan implementation",
            modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: "default",
            branch: input.branch,
            worktreePath: input.worktreePath,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        created = true;
      }
      approved = await approveWebDeepPlan({
        environmentId: input.environmentId,
        run,
        implementationThreadId: targetThreadId,
        implementation: modelSelection,
        requestedParallelism,
      });
      const result = await startTurn({
        environmentId: input.environmentId,
        input: {
          threadId: targetThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            attachments: [],
            text: buildDeepPlanImplementationPrompt(approved, {
              strategy:
                requestedParallelism > 1
                  ? { kind: "subagents", count: requestedParallelism }
                  : { kind: "standard" },
              ...(provider ? { provider } : {}),
            }),
          },
          modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: "default",
          deepPlanRunId: approved.id,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      useComposerDraftStore.getState().setComposerMode(input.draftTarget, "default");
      if (inNewThread) {
        await waitForStartedServerThread(scopeThreadRef(input.environmentId, targetThreadId));
        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: input.environmentId, threadId: targetThreadId },
        });
      }
    });
    if (outcome._tag === "Failure") {
      if (created && approved === null)
        await deleteThread({
          environmentId: input.environmentId,
          input: { threadId: targetThreadId, onlyIfUnused: true },
        });
      const cause = squashAtomCommandFailure(outcome);
      setError(cause instanceof Error ? cause.message : "Could not approve this DeepPlan.");
    }
    setPending(false);
  };
  return {
    reference: input.run?.plan
      ? { runId: input.run.id, planVersion: input.run.plan.version }
      : null,
    content:
      input.mode === "deep-plan" || input.run ? (
        <>
          {input.mode === "deep-plan" ? (
            <DeepPlanSourcePicker
              currentProject={currentProject}
              projectSourceCount={
                capturedSources
                  ? capturedSources.filter(
                      (source) =>
                        source.origin.environmentId === currentProject?.environmentId &&
                        source.origin.projectId === currentProject?.projectId,
                    ).length
                  : catalog.projectSourceCount
              }
              options={sourceOptions ?? catalog.options}
              selected={selectedSources}
              loading={catalog.loading}
              error={catalog.error}
              disabled={disabled || !input.supported || frozen}
              frozen={frozen}
              onOpen={catalog.onOpen}
              onChange={(selected) =>
                useComposerDraftStore.getState().setDeepPlanSourceRefs(input.draftTarget, selected)
              }
            />
          ) : null}
          {input.run ? (
            <>
              <DeepPlanAnalysisProgress
                key={`${input.environmentId}:${input.run.id}`}
                run={input.run}
              />
              <DeepPlanRunControls
                key={`${input.environmentId}:${input.threadRef.threadId}:${input.run.id}`}
                run={input.run}
                environmentId={input.environmentId}
                disabled={disabled}
                connected={input.connected}
                canContinue={!input.working && ownsContinuation}
                threadId={input.threadRef.threadId}
                latestRunId={input.latestRunId}
                onResume={continueRun}
                onFinalValidation={continueRun}
              />
            </>
          ) : null}
        </>
      ) : null,
    review: input.run?.plan ? (
      <div className="chat-content-lane py-3">
        <DeepPlanReviewCard
          key={`${input.environmentId}:${input.run.id}:${input.run.plan.version}`}
          run={input.run}
          environmentId={input.environmentId}
          threadRef={input.threadRef}
          workspaceRoot={input.workspaceRoot}
        />
        {input.run.phase === "awaitingApproval" ? (
          <div className="mt-2 flex items-center justify-end gap-2">
            {supportedCounts.length > 0 ? (
              <Menu>
                <MenuTrigger render={<Button variant="outline" disabled={disabled} />}>
                  {requestedParallelism === 1
                    ? translate("chat.composer.implementNormally")
                    : translate("chat.composer.implementWithSubagents", {
                        count: requestedParallelism,
                      })}
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={String(requestedParallelism)}
                    onValueChange={(value) => setParallelism(Number(value))}
                  >
                    {[1, ...supportedCounts].map((count) => (
                      <MenuRadioItem key={count} value={String(count)}>
                        {count === 1
                          ? translate("chat.composer.implementNormally")
                          : translate("chat.composer.implementWithSubagents", { count })}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            ) : null}
            <Button
              disabled={disabled || getDeepPlanApprovalBlockReason(input.run) !== null}
              onClick={() => void approve()}
            >
              {translate("chat.deepPlan.implement")}
            </Button>
            <Button
              variant="outline"
              disabled={disabled || getDeepPlanApprovalBlockReason(input.run) !== null}
              onClick={() => void approve(true)}
            >
              {translate("chat.deepPlan.implementNewThread")}
            </Button>
          </div>
        ) : null}
        {implementationThreadId && !ownsContinuation ? (
          <div className="mt-2 flex justify-end">
            <Button
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId: input.environmentId, threadId: implementationThreadId },
                })
              }
            >
              Open implementation chat
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    ) : null,
  };
}
