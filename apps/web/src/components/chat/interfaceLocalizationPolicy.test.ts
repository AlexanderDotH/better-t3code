import { describe, expect, it } from "vite-plus/test";

import chatMarkdownSource from "../ChatMarkdown.tsx?raw";
import subagentTranscriptSource from "../SubagentTranscriptPanel.tsx?raw";
import chatComposerSource from "./ChatComposer.tsx?raw";
import messagesTimelineSource from "./MessagesTimeline.tsx?raw";

describe("chat interface localization policy", () => {
  it("keeps provider and user-authored content outside interface translation", () => {
    expect(chatMarkdownSource).toContain("{text}\n        </ReactMarkdown>");
    expect(subagentTranscriptSource).toContain("text={message.text}");
    expect(messagesTimelineSource).toContain("text={messageText}");
    expect(messagesTimelineSource).toContain("text={props.text}");
    expect(chatComposerSource).toContain("promptRef.current = nextPrompt");

    for (const source of [
      chatMarkdownSource,
      subagentTranscriptSource,
      messagesTimelineSource,
      chatComposerSource,
    ]) {
      expect(source).not.toMatch(
        /translate\([^\n]*(?:message\.text|messageText|props\.text|nextPrompt)/u,
      );
    }
  });
});
