import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildTranscriptPortabilityOptions } from "./TranscriptPortabilitySettings.logic";

describe("buildTranscriptPortabilityOptions", () => {
  it("requires an explicit active thread from a capable environment", () => {
    const capable = EnvironmentId.make("capable");
    const unsupported = EnvironmentId.make("unsupported");
    const options = buildTranscriptPortabilityOptions(
      [
        {
          environmentId: capable,
          id: ThreadId.make("older"),
          title: "Older",
          updatedAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId: capable,
          id: ThreadId.make("newer"),
          title: "Newer",
          updatedAt: "2026-08-02T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId: unsupported,
          id: ThreadId.make("unsupported"),
          title: "Unsupported",
          updatedAt: "2026-08-03T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId: capable,
          id: ThreadId.make("archived"),
          title: "Archived",
          updatedAt: "2026-08-04T00:00:00.000Z",
          archivedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
      new Set([capable]),
    );

    expect(options.map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});
