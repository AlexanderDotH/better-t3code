import { describe, expect, it } from "vite-plus/test";

import {
  formatChatImportLatest,
  formatChatImportSummary,
  projectSpeechProfileStatus,
} from "./environment-data-settings";

describe("environment data settings helpers", () => {
  it("summarizes idempotent chat import results with correct plurals", () => {
    expect(
      formatChatImportSummary({
        projectsImported: 1,
        threadsImported: 1,
        messagesImported: 2,
        attachmentsCopied: 1,
        attachmentsSkipped: 2,
      }),
    ).toBe(
      "Synced 1 chat and 2 messages from 1 project. 1 attachment copied, 2 attachments unavailable.",
    );
    expect(
      formatChatImportSummary({
        projectsImported: 0,
        threadsImported: 0,
        messagesImported: 0,
        attachmentsCopied: 0,
        attachmentsSkipped: 0,
      }),
    ).toBe("Synced 0 chats and 0 messages from 0 projects.");
  });

  it("preserves undated and malformed latest-chat values", () => {
    expect(formatChatImportLatest(null)).toBe("No dated chats");
    expect(formatChatImportLatest("not-a-date")).toBe("not-a-date");
  });

  it("derives speech profile states without hiding a cached profile during refresh", () => {
    expect(projectSpeechProfileStatus({ source: "indexed" }, "loading")).toBe("Indexed");
    expect(projectSpeechProfileStatus({ source: "basic" }, "error")).toBe("Basic context");
    expect(projectSpeechProfileStatus(undefined, "loading")).toBe("Loading");
    expect(projectSpeechProfileStatus(undefined, "ready")).toBe("Not indexed");
    expect(projectSpeechProfileStatus(undefined, "error")).toBe("Unavailable");
  });
});
