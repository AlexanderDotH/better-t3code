import type { ApprovalRequestId, EnvironmentId, ThreadId, SubagentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "./atom-registry";

export function questionAttachmentDraftPrefix(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  replyTopicId?: SubagentId,
): string {
  const prefix = `${environmentId}:question-${encodeURIComponent(JSON.stringify(threadId))}-`;
  return replyTopicId
    ? `${prefix}reply-${encodeURIComponent(JSON.stringify(replyTopicId))}-`
    : prefix;
}
export function questionAttachmentDraftKey(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  questionId: string,
  replyTopicId?: SubagentId,
): string {
  return `${questionAttachmentDraftPrefix(environmentId, threadId, replyTopicId)}${encodeURIComponent(JSON.stringify([requestId, questionId]))}`;
}
export const questionAttachmentPreparationAtom = Atom.make<Record<string, number>>({}).pipe(
  Atom.keepAlive,
);
export function changeQuestionAttachmentPreparation(key: string, delta: number): void {
  const counts = appAtomRegistry.get(questionAttachmentPreparationAtom);
  if (delta < 0 && !(key in counts)) return;
  appAtomRegistry.set(questionAttachmentPreparationAtom, {
    ...counts,
    [key]: Math.max(0, (counts[key] ?? 0) + delta),
  });
}
