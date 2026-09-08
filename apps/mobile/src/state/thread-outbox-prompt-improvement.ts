import type { ProjectId } from "@t3tools/contracts";

import type { QueuedThreadMessage } from "./thread-outbox-model";

export type QueuedPromptPreparation =
  | { readonly _tag: "ready"; readonly message: QueuedThreadMessage }
  | { readonly _tag: "removed" }
  | { readonly _tag: "retry" };

export async function prepareQueuedPromptForDelivery(input: {
  readonly message: QueuedThreadMessage;
  readonly projectId: ProjectId;
  readonly improve: (text: string, projectId: ProjectId) => Promise<string>;
  readonly persist: (message: QueuedThreadMessage) => Promise<boolean>;
  readonly onError?: (stage: "improve" | "persist", error: unknown) => void;
}): Promise<QueuedPromptPreparation> {
  if (input.message.improvePromptBeforeSend !== true || input.message.text.trim().length === 0) {
    return { _tag: "ready", message: input.message };
  }

  let text: string;
  try {
    text = (await input.improve(input.message.text.trim(), input.projectId)).trim();
  } catch (error) {
    input.onError?.("improve", error);
    return { _tag: "retry" };
  }
  if (text.length === 0) {
    input.onError?.("improve", new Error("Prompt improvement returned empty text."));
    return { _tag: "retry" };
  }

  const { improvePromptBeforeSend: _, ...retained } = input.message;
  const improvedMessage: QueuedThreadMessage = { ...retained, text };
  try {
    return (await input.persist(improvedMessage))
      ? { _tag: "ready", message: improvedMessage }
      : { _tag: "removed" };
  } catch (error) {
    input.onError?.("persist", error);
    return { _tag: "retry" };
  }
}
