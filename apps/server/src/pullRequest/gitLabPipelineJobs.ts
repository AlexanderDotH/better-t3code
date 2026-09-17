import type { PullRequestCheck } from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import * as Schema from "effect/Schema";

const PipelineJob = Schema.Struct({
  id: Schema.Int,
  name: TrimmedNonEmptyString,
  stage: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  allow_failure: Schema.optional(Schema.Boolean),
  failure_reason: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
});

export type GitLabPipelineJob = typeof PipelineJob.Type;
export const decodePipelineJobsJson = decodeJsonResult(Schema.Array(PipelineJob));

export const decodePipelineJobDetailJson = decodeJsonResult(
  Schema.Struct({
    ...PipelineJob.fields,
    pipeline: Schema.Struct({ id: Schema.Int }),
    erased_at: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

function jobState(
  job: GitLabPipelineJob,
): Pick<PullRequestCheck, "status" | "statusLabel" | "pendingState"> {
  switch (job.status.toLowerCase()) {
    case "success":
      return { status: "success", statusLabel: "Passed" };
    case "failed":
      return job.allow_failure
        ? { status: "neutral", statusLabel: "Failed (allowed)" }
        : { status: "failure", statusLabel: "Failed" };
    case "canceled":
      return { status: "cancelled", statusLabel: "Cancelled" };
    case "skipped":
      return { status: "skipped", statusLabel: "Skipped" };
    case "manual":
      return job.allow_failure
        ? { status: "neutral", statusLabel: "Manual (optional)" }
        : { status: "action-required", statusLabel: "Manual" };
    case "running":
      return { status: "pending", statusLabel: "Running", pendingState: "running" };
    case "preparing":
      return { status: "pending", statusLabel: "Preparing", pendingState: "running" };
    case "canceling":
    case "cancelling":
      return { status: "pending", statusLabel: "Cancelling", pendingState: "running" };
    case "created":
      return { status: "pending", statusLabel: "Not started", pendingState: "queued" };
    case "pending":
      return { status: "pending", statusLabel: "Queued", pendingState: "queued" };
    case "waiting_for_resource":
      return { status: "pending", statusLabel: "Waiting for resource", pendingState: "queued" };
    case "waiting_for_callback":
      return { status: "pending", statusLabel: "Waiting for callback", pendingState: "queued" };
    case "scheduled":
      return { status: "pending", statusLabel: "Scheduled", pendingState: "queued" };
    default:
      return { status: "pending", statusLabel: "Pending", pendingState: "queued" };
  }
}

export function pipelineJobChecks(
  jobs: ReadonlyArray<GitLabPipelineJob>,
  logJobIds: ReadonlySet<number> = new Set(),
): PullRequestCheck[] {
  const latestJobs = new Map<string, GitLabPipelineJob>();
  // A retry can land between pages even when GitLab excludes retried attempts.
  for (const job of jobs.toSorted((left, right) => left.id - right.id)) {
    latestJobs.set(JSON.stringify([job.stage, job.name]), job);
  }
  return [...latestJobs.values()].map((job) => ({
    ...(logJobIds.has(job.id) ? { logId: job.id } : {}),
    name: job.name,
    ...jobState(job),
    ...(job.stage?.trim() ? { stage: job.stage.trim() } : {}),
    description: job.failure_reason?.trim() || null,
    url: job.web_url?.trim() || null,
  }));
}
