import { CommandId, MessageId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { resolveProviderInteractionMode } from "../../state/legacy-plan-mode";
import type { ServerProvider } from "@t3tools/contracts";

export function uniqueLaunchModels(selections: ReadonlyArray<ModelSelection>) {
  const unique = new Map<string, ModelSelection>();
  for (const selection of selections) {
    const key = JSON.stringify([selection.instanceId, selection.model]);
    if (!unique.has(key)) unique.set(key, selection);
  }
  return [...unique.values()];
}

export function planMultiModelLaunch(input: {
  readonly message: QueuedThreadMessage;
  readonly selections: ReadonlyArray<ModelSelection>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly baseBranch: string | null;
  readonly metadataForSelection: (selection: ModelSelection, index: number) => TurnCommandMetadata;
}): ReadonlyArray<QueuedThreadMessage> {
  const unique = uniqueLaunchModels(input.selections);
  if (
    unique.length > 1 &&
    (input.message.composerMode === "deep-plan" ||
      /^\s*\/deep-plan(?:\s|$)/i.test(input.message.text))
  )
    throw new Error("DeepPlan supports one model at a time.");
  if (unique.length > 1 && (!input.message.creation || !input.baseBranch))
    throw new Error("Choose a Git project and base branch before launching multiple models.");
  return unique.map((modelSelection, index) => {
    const metadata = input.metadataForSelection(modelSelection, index);
    return {
      ...input.message,
      threadId: ThreadId.make(metadata.threadId),
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      createdAt: metadata.createdAt,
      modelSelection,
      interactionMode: resolveProviderInteractionMode(
        input.providers.find((provider) => provider.instanceId === modelSelection.instanceId),
        input.message.interactionMode ?? "default",
      ),
      ...(unique.length > 1 && input.message.creation
        ? {
            creation: {
              ...input.message.creation,
              workspaceMode: "worktree",
              worktreePath: null,
              branch: input.baseBranch,
            },
          }
        : {}),
    };
  });
}
