import { SubagentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { environmentSubagentSnapshotPath } from "./subagentSnapshotHttp.ts";

describe("subagent snapshot HTTP", () => {
  it("encodes thread and subagent identifiers as individual path segments", () => {
    expect(
      environmentSubagentSnapshotPath(
        ThreadId.make("thread with/slash"),
        SubagentId.make("agent/child"),
      ),
    ).toBe("/api/orchestration/threads/thread%20with%2Fslash/subagents/agent%2Fchild");
  });
});
