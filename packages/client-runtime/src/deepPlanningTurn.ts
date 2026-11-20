import {
  DEEP_PLAN_MAX_CHATS,
  DEEP_PLAN_MAX_PARALLELISM,
  isDeepPlanRun,
  type DeepPlanSourceRef,
  type OrchestrationV2Command,
  type StoredDeepPlanRun,
} from "@t3tools/contracts";

import { getDeepPlanApprovalBlockReason } from "./deepPlanningRun.ts";

type StartCommand = Extract<OrchestrationV2Command, { readonly type: "thread.deep-plan.start" }>;
type UpdateCommand = Extract<OrchestrationV2Command, { readonly type: "thread.deep-plan.update" }>;
type Approval = Extract<UpdateCommand["mutation"], { readonly type: "approve" }>;

export function deepPlanSourceRefKey(ref: DeepPlanSourceRef): string {
  return JSON.stringify([ref.environmentId, ref.projectId, ref.threadId]);
}

export function uniqueDeepPlanSourceRefs(
  refs: ReadonlyArray<DeepPlanSourceRef>,
): ReadonlyArray<DeepPlanSourceRef> {
  return [...new Map(refs.map((ref) => [deepPlanSourceRefKey(ref), ref])).values()];
}

export function buildDeepPlanStartCommand(
  input: Pick<StartCommand, "commandId" | "threadId" | "createdAt"> &
    Partial<Pick<StartCommand, "chats" | "includeProjectChats">>,
): StartCommand {
  const chats = uniqueDeepPlanSourceRefs(input.chats ?? []);
  if (chats.length > DEEP_PLAN_MAX_CHATS) {
    throw new Error(`Choose up to ${DEEP_PLAN_MAX_CHATS} chats for Deep Plan.`);
  }
  return {
    type: "thread.deep-plan.start",
    commandId: input.commandId,
    threadId: input.threadId,
    createdAt: input.createdAt,
    chats,
    includeProjectChats: input.includeProjectChats === true,
  };
}

export function buildDeepPlanApproveCommand(
  input: Pick<UpdateCommand, "commandId" | "operationId" | "createdAt"> &
    Pick<Approval, "implementation" | "implementationThread" | "parallelism" | "reviewer"> & {
      readonly run: StoredDeepPlanRun;
    },
): UpdateCommand {
  const { run, parallelism, reviewer } = input;
  const reason = getDeepPlanApprovalBlockReason(run);
  if (reason || !isDeepPlanRun(run) || !run.plan || !run.approvalKey) {
    throw new Error(reason ?? "Refresh Deep Plan before approving it.");
  }
  if (
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > DEEP_PLAN_MAX_PARALLELISM
  ) {
    throw new Error(`Choose between 1 and ${DEEP_PLAN_MAX_PARALLELISM} Deep Plan lanes.`);
  }
  return {
    type: "thread.deep-plan.update",
    commandId: input.commandId,
    threadId: run.threadId,
    runId: run.id,
    expectedRevision: run.revision,
    operationId: input.operationId,
    createdAt: input.createdAt,
    mutation: {
      type: "approve",
      planVersion: run.plan.version,
      approvalKey: run.approvalKey,
      implementation: input.implementation,
      implementationThread: input.implementationThread,
      parallelism,
      ...(reviewer === undefined ? {} : { reviewer }),
    },
  };
}
