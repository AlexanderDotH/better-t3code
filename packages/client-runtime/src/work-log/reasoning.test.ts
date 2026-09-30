import { describe, expect, it } from "vite-plus/test";

import { reasoningTitleMarkdown } from "./reasoning.ts";

describe("reasoningTitleMarkdown", () => {
  it.each([
    {
      name: "bold title",
      text: "**Inspecting the settings loader**\n\nThe saved preference must survive normalization.",
      title: "**Inspecting the settings loader**",
    },
    {
      name: "heading title",
      text: "### Checking the stream\n\nThe body describes each incoming event.",
      title: "### Checking the stream",
    },
    {
      name: "native summary",
      text: "Verifying the adapter\nThe provider sends a summary and a longer body.",
      title: "Verifying the adapter",
    },
    {
      name: "blockquote title",
      text: "> Following the receipt\n\nWait for the worker drain.",
      title: "> Following the receipt",
    },
    {
      name: "inline code title",
      text: "Checking `thread.message-sent`\n\nKeep every reasoning delta.",
      title: "Checking `thread.message-sent`",
    },
    {
      name: "linked title",
      text: "Inspecting [the schema](https://example.test/schema)\n\nDetails stay in the work view.",
      title: "Inspecting [the schema](https://example.test/schema)",
    },
    {
      name: "leading blank lines and CRLF",
      text: "\r\n \t\r\n  **Checking the cache**  \r\n\r\nDo not flatten this body into the title.",
      title: "**Checking the cache**",
    },
    {
      name: "legacy carriage return",
      text: "Checking portability\rThe remainder is the body.",
      title: "Checking portability",
    },
    {
      name: "streaming partial title",
      text: "**Inspecting the",
      title: "**Inspecting the",
    },
    {
      name: "single line with outer whitespace",
      text: "  Checking provider capabilities \t",
      title: "Checking provider capabilities",
    },
    {
      name: "title followed by a code block",
      text: "Running the focused checks\n\n```sh\nvp test run\n```",
      title: "Running the focused checks",
    },
  ])("extracts only the first nonempty line for $name", ({ text, title }) => {
    expect(reasoningTitleMarkdown(text, "Thinking")).toBe(title);
  });

  it.each(["", " \t\r\n", "```ts\nconst body = true;\n```", "\n~~~text\nReasoning body\n~~~"])(
    "uses the supplied fallback instead of an empty or fenced title: %j",
    (text) => {
      expect(reasoningTitleMarkdown(text, "Réflexion")).toBe("Réflexion");
    },
  );
});
