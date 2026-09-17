import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";

import { decodePipelineJobsJson, pipelineJobChecks } from "./gitLabPipelineJobs.ts";

describe("GitLab pipeline jobs", () => {
  it.each([
    ["created", false, "pending", "Not started", "queued"],
    ["pending", false, "pending", "Queued", "queued"],
    ["running", false, "pending", "Running", "running"],
    ["preparing", false, "pending", "Preparing", "running"],
    ["waiting_for_resource", false, "pending", "Waiting for resource", "queued"],
    ["waiting_for_callback", false, "pending", "Waiting for callback", "queued"],
    ["scheduled", false, "pending", "Scheduled", "queued"],
    ["success", false, "success", "Passed", undefined],
    ["failed", false, "failure", "Failed", undefined],
    ["failed", true, "neutral", "Failed (allowed)", undefined],
    ["manual", false, "action-required", "Manual", undefined],
    ["manual", true, "neutral", "Manual (optional)", undefined],
    ["canceled", false, "cancelled", "Cancelled", undefined],
    ["canceling", false, "pending", "Cancelling", "running"],
    ["skipped", false, "skipped", "Skipped", undefined],
    ["future-status", false, "pending", "Pending", "queued"],
  ] as const)(
    "presents %s (allowed failure: %s) honestly",
    (rawStatus, allowFailure, status, label, pendingState) => {
      const [check] = pipelineJobChecks([
        {
          id: 1,
          name: "unit-coverage",
          stage: "test",
          status: rawStatus,
          allow_failure: allowFailure,
          web_url: "https://gitlab.example/acme/web/-/jobs/1",
        },
      ]);
      expect(check).toMatchObject({
        name: "unit-coverage",
        stage: "test",
        status,
        statusLabel: label,
      });
      expect(check?.pendingState).toBe(pendingState);
      expect(check?.url).toBe("https://gitlab.example/acme/web/-/jobs/1");
    },
  );

  it("keeps the latest retry without losing identically named jobs in other stages", () => {
    const checks = pipelineJobChecks([
      { id: 4, name: "build", stage: "test", status: "running" },
      { id: 2, name: "build", stage: "test", status: "failed" },
      { id: 3, name: "build", stage: "deploy", status: "created" },
      { id: 1, name: "lint", stage: "quality", status: "success" },
    ]);
    expect(checks.map(({ name, stage, statusLabel }) => [name, stage, statusLabel])).toEqual([
      ["lint", "quality", "Passed"],
      ["build", "test", "Running"],
      ["build", "deploy", "Not started"],
    ]);
  });

  it("rejects malformed job data rather than showing a deceptively complete list", () => {
    expect(
      Result.isFailure(decodePipelineJobsJson('[{"id":1,"name":"","status":"running"}]')),
    ).toBe(true);
    expect(Result.isFailure(decodePipelineJobsJson('{"message":"Forbidden"}'))).toBe(true);
  });
});
