import type { ChatVisualMode } from "@t3tools/contracts";

export const CHAT_THINKING_PHRASE_KEYS = [
  "chat.thinking.squiggling",
  "chat.thinking.noodles",
  "chat.thinking.ducks",
  "chat.thinking.hypothesis",
  "chat.thinking.pixels",
  "chat.thinking.synapses",
  "chat.thinking.gremlins",
  "chat.thinking.eureka",
  "chat.thinking.hamsters",
  "chat.thinking.clouds",
  "chat.thinking.confetti",
  "chat.thinking.wizards",
  "chat.thinking.pretzels",
  "chat.thinking.fireflies",
  "chat.thinking.teapot",
  "chat.thinking.goblins",
  "chat.thinking.bubbles",
  "chat.thinking.stardust",
  "chat.thinking.sock",
  "chat.thinking.tinyDrumroll",
] as const;

export const CHAT_THINKING_ROW_ID = "thinking-indicator-row";
export const CHAT_THINKING_CYCLE_MS = 2400;
export const CHAT_THINKING_PHRASE_CYCLES = 3;
export const CHAT_THINKING_WAVE_TRAVEL = 0.65;

/** Feed messages in timeline order; continuations and orphan traces share the last user request. */
export function createChatReasoningScope() {
  const requestsByTopic = new Map<string | null, string>();
  return (message?: { id: string; role: string; replyTopicId?: string | undefined }) => {
    const topic = message?.replyTopicId ?? null;
    if (message?.role === "user") requestsByTopic.set(topic, message.id);
    return JSON.stringify([topic, requestsByTopic.get(topic) ?? null]);
  };
}

export interface ChatPresentationInput {
  readonly mode: ChatVisualMode;
  readonly presentationMotion: boolean;
  readonly characterStreamingMotion: boolean;
  readonly reducedMotion: boolean;
}

/** Resolves presentation from effective settings; capability policy stays with the settings owner. */
export function resolveChatPresentation(input: ChatPresentationInput) {
  return {
    mode: input.mode,
    grouping: input.mode,
    variant: input.mode,
    presentationMotion:
      input.mode === "better-t3" && input.presentationMotion && !input.reducedMotion,
    characterStreamingMotion: input.characterStreamingMotion && !input.reducedMotion,
  };
}
