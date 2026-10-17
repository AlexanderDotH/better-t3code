import {
  prepareDeepPlanForTurn,
  resolveDeepPlanningAvailability,
  type DeepPlanningApi,
} from "@t3tools/client-runtime/deep-planning";
import {
  CommandId,
  type ClientOrchestrationCommand,
  type EnvironmentId,
  type ProjectId,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
} from "@t3tools/contracts";

import type { QueuedThreadMessage } from "./thread-outbox-model";

type ThreadCreation = Omit<
  Extract<ClientOrchestrationCommand, { type: "thread.create" }>,
  "type" | "commandId" | "threadId"
>;

async function identifierFactory(injected: (() => string) | undefined): Promise<() => string> {
  if (injected !== undefined) return injected;
  const uuid = await import("../lib/uuid");
  return () => uuid.randomHex(16);
}

export async function prepareQueuedDeepPlan(input: {
  readonly message: QueuedThreadMessage;
  readonly projectId: ProjectId;
  readonly creation?: ThreadCreation;
  readonly capabilities: ExecutionEnvironmentCapabilities;
  readonly provider: ServerProvider | undefined;
  readonly apiForEnvironment?: (environmentId: EnvironmentId) => DeepPlanningApi;
  readonly createId?: () => string;
}): Promise<void> {
  if (input.message.composerMode !== "deep-plan") return;
  const availability = resolveDeepPlanningAvailability({
    capabilities: input.capabilities,
    provider: input.provider,
  });
  if (!availability.supported)
    throw new Error(availability.reason ?? "Deep Planning is unavailable.");
  const apiForEnvironment =
    input.apiForEnvironment ?? (await import("./deep-planning")).getMobileDeepPlanningApi;
  const createId = await identifierFactory(input.createId);
  const api = apiForEnvironment(input.message.environmentId);
  if (input.creation) {
    await api.dispatchCommand({
      ...input.creation,
      type: "thread.create",
      commandId: CommandId.make(input.message.commandId + ":deep-plan-owner"),
      threadId: input.message.threadId,
    });
  }
  await prepareDeepPlanForTurn({
    environmentId: input.message.environmentId,
    projectId: input.projectId,
    threadId: input.message.threadId,
    additionalSourceRefs: input.message.deepPlanSourceRefs,
    apiForEnvironment,
    createId,
  });
}
