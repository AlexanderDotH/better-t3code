import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useChatWidthMotion } from "./ChatSizeMotion";
import {
  CHAT_THINKING_CYCLE_MS,
  CHAT_THINKING_PHRASE_CYCLES,
  CHAT_THINKING_PHRASE_KEYS,
  CHAT_THINKING_WAVE_TRAVEL,
} from "@t3tools/client-runtime/chat-presentation";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";

export function ChatThinkingIndicator({ motion }: { motion: boolean }) {
  const translate = useInterfaceTranslator().message;
  const [phraseIndex, setPhraseIndex] = useState(0);
  const cycles = useRef(0);
  const widthRef = useChatWidthMotion<HTMLSpanElement>(phraseIndex, motion);
  const attach = useCallback(
    (element: HTMLSpanElement | null) => {
      widthRef.current = element;
      return motion ? observeVisibleAnimation(element) : undefined;
    },
    [motion, widthRef],
  );
  const characters = Array.from(
    translate(CHAT_THINKING_PHRASE_KEYS[phraseIndex]!).normalize("NFC"),
  );
  return (
    <span
      ref={attach}
      className="better-chat-thinking"
      data-motion={motion}
      style={{ "--thinking-cycle": `${CHAT_THINKING_CYCLE_MS}ms` } as CSSProperties}
    >
      <span className="sr-only">{translate("chat.timeline.thinking")}</span>
      <span
        aria-hidden
        className="better-chat-thinking-glyph"
        onAnimationIteration={(event) => {
          if (event.animationName !== "better-chat-thinking-north" || !motion) return;
          cycles.current += 1;
          if (cycles.current % CHAT_THINKING_PHRASE_CYCLES === 0) {
            setPhraseIndex((index) => (index + 1) % CHAT_THINKING_PHRASE_KEYS.length);
          }
        }}
      >
        <span className="better-chat-thinking-core" />
        <span className="better-chat-thinking-lobe" data-side="north" />
        <span className="better-chat-thinking-lobe" data-side="east" />
        <span className="better-chat-thinking-lobe" data-side="south" />
        <span className="better-chat-thinking-lobe" data-side="west" />
      </span>
      <span aria-hidden className="better-chat-thinking-word" key={phraseIndex}>
        {characters.map((character, index) => (
          <span
            key={index}
            className="better-chat-thinking-character"
            data-character={character}
            style={
              {
                "--thinking-character-delay": `${
                  (index / Math.max(1, characters.length - 1)) *
                  CHAT_THINKING_WAVE_TRAVEL *
                  CHAT_THINKING_CYCLE_MS
                }ms`,
              } as CSSProperties
            }
          >
            {character}
          </span>
        ))}
      </span>
    </span>
  );
}
