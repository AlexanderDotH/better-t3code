import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import {
  parseAssistantCitationHref,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";
import { buildAssistantQuote } from "./assistantQuote";

const source = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
};
describe("assistant selection citations", () => {
  it("anchors selected rendered text with context and serializes a usable source link", () => {
    const citation = buildAssistantQuote({
      ...source,
      markdown: "Before **selected** text after.",
      text: "selected text",
      start: 7,
    });
    expect(citation).toMatchObject({
      ...source,
      version: 1,
      text: "selected text",
      start: 7,
      end: 20,
      prefix: "Before ",
      suffix: " after.",
    });
    const serialized = serializeAssistantCitation(citation!);
    expect(parseAssistantCitationHref(serialized.slice(serialized.indexOf("(") + 1, -1))).toEqual(
      citation,
    );
  });
  it("uses the closest repeated occurrence and rejects blank or oversized quotes", () => {
    const repeated = "First needle.\n\nSecond needle.";
    expect(
      buildAssistantQuote({
        ...source,
        markdown: repeated,
        selectionMarkdown: "Second needle.",
        text: "needle",
        start: 7,
      })?.start,
    ).toBe(21);
    expect(
      buildAssistantQuote({ ...source, markdown: "one quote two quote", text: "quote", start: 14 })
        ?.start,
    ).toBe(14);
    expect(buildAssistantQuote({ ...source, markdown: "one", text: " ", start: 0 })).toBeNull();
    expect(
      buildAssistantQuote({
        ...source,
        markdown: "x".repeat(8001),
        text: "x".repeat(8001),
        start: 0,
      }),
    ).toBeNull();
    expect(
      buildAssistantQuote({
        ...source,
        markdown: "A [linked](https://example.com)\n\npassage",
        text: "linked passage",
        start: 2,
      }),
    ).toMatchObject({ text: "linked passage", start: 2 });
  });
});
