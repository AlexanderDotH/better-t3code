import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendFetchWorkerFindings,
  FETCH_WORKER_FINDINGS_MAX_CHARS,
  syntheticFetchWorkerId,
} from "./FetchWorkerState.ts";

describe("Fetch worker state", () => {
  it("bounds retained findings once and ignores later deltas", () => {
    const state = { findings: "", findingsTruncated: false };
    appendFetchWorkerFindings(state, "x".repeat(FETCH_WORKER_FINDINGS_MAX_CHARS + 10_000));
    const retained = state.findings;
    appendFetchWorkerFindings(state, "late output");

    expect(state.findings).toHaveLength(FETCH_WORKER_FINDINGS_MAX_CHARS);
    expect(state.findings).toBe(retained);
    expect(state.findings).toContain("worker findings truncated");
    expect(state.findingsTruncated).toBe(true);
  });

  it("derives a stable environment-local worker identity", () => {
    expect(syntheticFetchWorkerId(ThreadId.make("parent"), "run-1", 3)).toBe(
      "fetch:parent:run-1:3",
    );
  });
});
