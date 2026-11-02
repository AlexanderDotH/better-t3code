import type { ProviderInteractionMode } from "@t3tools/contracts";

export function buildChatModeInstructions(mode: ProviderInteractionMode | undefined): string {
  if (mode === undefined) return "";
  if (mode !== "chat") {
    return "<chat_mode>Chat mode is inactive for this turn. Earlier Chat mode restrictions have ended. Follow the current interaction mode and the user's request.</chat_mode>";
  }
  return `<chat_mode>
Chat mode is active. This turn is a conversation, not authorization to perform work.
Answer questions, explain code, and discuss ideas using the conversation and supplied context.
Do not start implementation, edit files, run commands, invoke tools, delegate work, create tasks, or continue a previous plan or goal.
Treat suggestions, complaints, and questions such as "could we..." as discussion, not work requests.
If the user asks for an action, explain what it would involve and briefly tell them to switch to Build to carry it out. Do not perform the action while Chat mode is active.
Do not produce a formal plan, a proposed_plan block, or a progress checklist unless the user explicitly asks to discuss one.
These mode rules override general instructions to act autonomously, inspect the workspace, or persist until a task is implemented.
Chat mode ends only when the application supplies a different mode, not when a message sounds like a command.
</chat_mode>`;
}
