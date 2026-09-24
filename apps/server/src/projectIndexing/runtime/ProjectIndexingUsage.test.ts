import { describe, expect, it } from "@effect/vitest";
import { EMPTY_PROJECT_INDEX_USAGE } from "@t3tools/contracts";

import { recordProjectIndexRequest } from "./ProjectIndexingUsage.ts";

describe("project index provider usage", () => {
  it("keeps missing provider counters unavailable without inventing zero tokens", () => {
    const first = recordProjectIndexRequest(EMPTY_PROJECT_INDEX_USAGE);
    const second = recordProjectIndexRequest(first);
    expect(second).toEqual({ requests: 2, usageStatus: "unavailable" });
  });

  it("retains an interrupted request as partial usage after resuming", () => {
    const interrupted = recordProjectIndexRequest(EMPTY_PROJECT_INDEX_USAGE);
    const resumed = recordProjectIndexRequest(interrupted, { inputTokens: 500, outputTokens: 100 });
    expect(resumed).toEqual({
      requests: 2,
      usageStatus: "partial",
      inputTokens: 500,
      outputTokens: 100,
    });
  });
});
