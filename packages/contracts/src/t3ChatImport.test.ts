import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { T3ChatImportDiscoverResult, T3ChatImportRunResult } from "./t3ChatImport.ts";

describe("T3 chat import contracts", () => {
  it("decodes discovered local instances with chat metadata", () => {
    const decode = Schema.decodeUnknownSync(T3ChatImportDiscoverResult);

    expect(
      decode({
        sources: [
          {
            id: "source-1",
            label: "T3 Code Local (userdata)",
            databasePath: "/home/alex/.t3-local/userdata/state.sqlite",
            threadCount: 12,
            latestUpdatedAt: "2026-07-12T10:00:00.000Z",
          },
        ],
      }).sources[0]?.threadCount,
    ).toBe(12);
  });

  it("decodes import counts", () => {
    const decode = Schema.decodeUnknownSync(T3ChatImportRunResult);

    expect(
      decode({
        projectsImported: 2,
        threadsImported: 5,
        messagesImported: 31,
        attachmentsCopied: 3,
        attachmentsSkipped: 1,
      }).messagesImported,
    ).toBe(31);
  });
});
