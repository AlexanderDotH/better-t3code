import {
  buildDeepPlanStartCommand,
  isDeepPlanLegacyRun,
  resolveDeepPlanningAvailability,
} from "@t3tools/client-runtime/deep-planning";
import {
  CommandId,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
  type StoredDeepPlanRun,
} from "@t3tools/contracts";
import { currentInterfaceTranslator } from "../localization/currentInterfaceTranslator";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export function buildQueuedDeepPlanStartCommand(input: {
  readonly message: QueuedThreadMessage;
  readonly capabilities: ExecutionEnvironmentCapabilities;
  readonly provider: ServerProvider | undefined;
  readonly currentRun?: StoredDeepPlanRun | null;
}) {
  const { message, currentRun } = input;
  if (message.sourceProposedPlan?.deepPlan) {
    throw new Error(currentInterfaceTranslator().message("chat.deepPlan.status.legacy"));
  }
  if (message.composerMode !== "deep-plan") return undefined;
  const translator = currentInterfaceTranslator();
  const availability = resolveDeepPlanningAvailability(input);
  if (!availability.supported) {
    throw new Error(
      availability.reasonKey
        ? translator.message(availability.reasonKey)
        : translator.message("mobile.ui.deepPlanningCouldNotStart"),
    );
  }
  if (currentRun && !isDeepPlanLegacyRun(currentRun)) {
    if (
      currentRun.threadId !== message.threadId ||
      currentRun.phase === "implementing" ||
      currentRun.phase === "finalReview"
    ) {
      throw new Error(translator.message("chat.deepPlan.finishActiveRun"));
    }
    if (
      currentRun.phase === "planning" ||
      currentRun.phase === "awaitingApproval" ||
      currentRun.phase === "paused"
    ) {
      return undefined;
    }
  }
  return buildDeepPlanStartCommand({
    threadId: message.threadId,
    commandId: CommandId.make(`${message.commandId}:deep-plan-start`),
    createdAt: message.createdAt,
    chats: message.deepPlanSourceRefs ?? [],
    includeProjectChats: message.deepPlanIncludeProjectChats === true,
  });
}
