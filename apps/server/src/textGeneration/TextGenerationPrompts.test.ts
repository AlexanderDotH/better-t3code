import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildFetchExplorationPrompt,
  buildPlanParallelismReviewPrompt,
  buildPromptImprovementPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
  buildTranscriptTranslationPrompt,
  PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
  PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
  FETCH_EXPLORATION_REQUEST_MAX_CHARS,
  FetchExplorationOutputSchema,
  PlanParallelismReviewOutputSchema,
  PromptImprovementOutputSchema,
  truncatePlanParallelismReviewContext,
  TranscriptTranslationOutputSchema,
} from "./TextGenerationPrompts.ts";
import { normalizeCliError, sanitizeThreadTitle } from "./TextGenerationUtils.ts";
import { TextGenerationError } from "@t3tools/contracts";

const decodePromptImprovementOutput = Schema.decodeUnknownSync(PromptImprovementOutputSchema);
const decodeTranscriptTranslationOutput = Schema.decodeUnknownSync(
  TranscriptTranslationOutputSchema,
);
const decodePlanParallelismReviewOutput = Schema.decodeUnknownSync(
  PlanParallelismReviewOutputSchema,
);
const decodeFetchExplorationOutput = Schema.decodeUnknownSync(FetchExplorationOutputSchema);

describe("buildCommitMessagePrompt", () => {
  it("includes staged patch and summary in the prompt", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md\n+hello",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Staged files:");
    expect(result.prompt).toContain("M README.md");
    expect(result.prompt).toContain("Staged patch:");
    expect(result.prompt).toContain("diff --git a/README.md b/README.md");
    expect(result.prompt).toContain("Branch: main");
    // Should NOT include the branch generation instruction
    expect(result.prompt).not.toContain("branch must be a short semantic git branch fragment");
  });

  it("includes branch generation instruction when includeBranch is true", () => {
    const result = buildCommitMessagePrompt({
      branch: "feature/foo",
      stagedSummary: "M README.md",
      stagedPatch: "diff",
      includeBranch: true,
    });

    expect(result.prompt).toContain("branch must be a short semantic git branch fragment");
    expect(result.prompt).toContain("Return a JSON object with keys: subject, body, branch.");
  });

  it("shows (detached) when branch is null", () => {
    const result = buildCommitMessagePrompt({
      branch: null,
      stagedSummary: "M a.ts",
      stagedPatch: "diff",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Branch: (detached)");
  });

  it("includes policy instructions", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M a.ts",
      stagedPatch: "diff",
      includeBranch: false,
      policy: {
        kind: "custom",
        commitInstructions: "Use a terse repository-specific subject.",
        inferRepositoryConventions: false,
      },
    });

    expect(result.prompt).toContain("Additional instructions:");
    expect(result.prompt).toContain("Use a terse repository-specific subject.");
  });
});

describe("buildPrContentPrompt", () => {
  it("includes branch names, commits, and diff in the prompt", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff --git a/auth.ts b/auth.ts\n+export function login()",
    });

    expect(result.prompt).toContain("Base branch: main");
    expect(result.prompt).toContain("Head branch: feature/auth");
    expect(result.prompt).toContain("Commits:");
    expect(result.prompt).toContain("feat: add login page");
    expect(result.prompt).toContain("Diff stat:");
    expect(result.prompt).toContain("3 files changed");
    expect(result.prompt).toContain("Diff patch:");
    expect(result.prompt).toContain("export function login()");
    expect(result.prompt).toContain("include headings '## Summary' and '## Testing'");
  });

  it("follows a repository PR template instead of the default body headings", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff",
      changeRequestTemplate: "<!-- remove me -->\n## What changed\n\n## Verification",
      policy: {
        kind: "custom",
        changeRequestInstructions: "Keep the title in sentence case.",
        inferRepositoryConventions: false,
      },
    });

    expect(result.prompt).toContain("Keep the title in sentence case.");
    expect(result.prompt).toContain("follow the repository change request template structure");
    expect(result.prompt).toContain("drop HTML comments from the template");
    expect(result.prompt).toContain("Repository change request template:");
    expect(result.prompt).toContain("<!-- remove me -->\n## What changed\n\n## Verification");
    expect(result.prompt).not.toContain("include headings '## Summary' and '## Testing'");
  });
});

describe("buildBranchNamePrompt", () => {
  it("includes the user message in the prompt", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the login timeout bug",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Fix the login timeout bug");
    expect(result.prompt).not.toContain("Attachment metadata:");
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the layout from screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-123",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 12345,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("screenshot.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("12345 bytes");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("includes the user message in the prompt", () => {
    const result = buildThreadTitlePrompt({
      message: "Investigate reconnect regressions after session restore",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Investigate reconnect regressions after session restore");
    expect(result.prompt).not.toContain("Attachment metadata:");
    expect(result.prompt).toContain(
      "Generate a title that will help the user recognize this T3 Code thread weeks later.",
    );
    expect(result.prompt).toContain(
      "Title the subject and outcome. Discard incidental instructions.",
    );
    expect(result.prompt).toContain(
      "Name the product change, not the mock, plan, report, branch, or PR used to produce it.",
    );
    expect(result.prompt).not.toContain(
      "Title should summarize the user's request, not restate it verbatim.",
    );
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildThreadTitlePrompt({
      message: "Name this thread from the screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-456",
          name: "thread.png",
          mimeType: "image/png",
          sizeBytes: 67890,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("thread.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("67890 bytes");
  });

  it("regenerates from recent thread contents and identifies the previous title", () => {
    const result = buildThreadTitlePrompt({
      message: `USER:\nInvestigate reconnect regressions\n\nASSISTANT:\nThe remaining issue is stale session state`,
      previousTitle: "Investigate reconnect regressions",
    });

    expect(result.prompt).toContain(
      "Regenerate the title for an existing T3 Code thread so the user can recognize it weeks later.",
    );
    expect(result.prompt).toContain('The previous title was "Investigate reconnect regressions".');
    expect(result.prompt).toContain(
      "Read the USER messages first. Identify the latest explicit durable goal.",
    );
    expect(result.prompt).toContain(
      "Do not promote one assistant finding into the thread subject unless the user adopts it as a new goal.",
    );
    expect(result.prompt).toContain(
      'A subagent-monitoring review that finds a Codex roster bug remains "Review Subagent Monitoring Risks,"',
    );
    expect(result.prompt).toContain("Thread contents:");
    expect(result.prompt).toContain("The remaining issue is stale session state");
  });

  it("keeps the latest thread contents when regeneration context is truncated", () => {
    const result = buildThreadTitlePrompt({
      message: `${"old context ".repeat(1_000)}\n\nASSISTANT:\nCurrent thread state`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain("[Earlier content truncated]");
    expect(result.prompt).toContain("Current thread state");
    expect(result.prompt).not.toContain("[truncated]");
  });

  it("does not truncate an already-marked regeneration context twice", () => {
    const retainedContext = "x".repeat(7_998);
    const result = buildThreadTitlePrompt({
      message: `[Earlier content truncated]\n\n${retainedContext}`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain(
      `Thread contents:\n[Earlier content truncated]\n\n${retainedContext}`,
    );
    expect(result.prompt.match(/\[Earlier content truncated\]/g)).toHaveLength(1);
  });
});

describe("buildTranscriptTranslationPrompt", () => {
  it("requires faithful concise English while preserving code identifiers", () => {
    const result = buildTranscriptTranslationPrompt({
      text: "Actualiza `useThreadOutbox` sin cambiar drainQueue.",
    });

    expect(result.prompt).toContain("faithful, concise English");
    expect(result.prompt).toContain("Preserve code identifiers");
    expect(result.prompt).toContain("Actualiza `useThreadOutbox` sin cambiar drainQueue.");
    expect(decodeTranscriptTranslationOutput({ text: "Update `useThreadOutbox`." })).toEqual({
      text: "Update `useThreadOutbox`.",
    });
  });
});

describe("buildPromptImprovementPrompt", () => {
  it("preserves language, requirements, identifiers, and scope", () => {
    const result = buildPromptImprovementPrompt({
      text: "Corrige reconnectSession, no cambies el contrato RPC.",
    });

    expect(result.prompt).toContain("Keep the same language");
    expect(result.prompt).toContain("Preserve the original intent and every requirement");
    expect(result.prompt).toContain("Do not add scope");
    expect(result.prompt).toContain("Corrige reconnectSession, no cambies el contrato RPC.");
    expect(decodePromptImprovementOutput({ text: "Corrige `reconnectSession`." })).toEqual({
      text: "Corrige `reconnectSession`.",
    });
  });
});

describe("buildPlanParallelismReviewPrompt", () => {
  it("asks only for a direct-child count within the implementation provider ceiling", () => {
    const result = buildPlanParallelismReviewPrompt({
      planMarkdown: "## Server\nAdd the RPC.\n\n## Web\nAdd the review state.",
      userRequest: "Implement the plan with useful parallelism.",
      maxSubagents: 12,
    });

    expect(result.prompt).toContain("direct child subagents");
    expect(result.prompt).toContain("between 2 and 12");
    expect(result.prompt).toContain("Do not artificially stop at four");
    expect(result.prompt).toContain("Do not execute the plan, use tools, inspect the filesystem");
    expect(result.prompt).toContain("Originating user request:");
    expect(result.prompt).toContain("Proposed plan:");
    expect(result.prompt).not.toContain('workstreams":');
    expect(decodePlanParallelismReviewOutput({ recommendedSubagents: 6 })).toEqual({
      recommendedSubagents: 6,
    });
    expect(() => decodePlanParallelismReviewOutput({ recommendedSubagents: 2.5 })).toThrow();
  });

  it("keeps each review context inside its exact character budget", () => {
    const plan = `${"p".repeat(PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS)}PLAN_TAIL`;
    const request = `${"r".repeat(PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS)}REQUEST_TAIL`;

    const truncatedPlan = truncatePlanParallelismReviewContext(
      plan,
      PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
    );
    const truncatedRequest = truncatePlanParallelismReviewContext(
      request,
      PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
    );
    const result = buildPlanParallelismReviewPrompt({
      planMarkdown: plan,
      userRequest: request,
      maxSubagents: 8,
    });

    expect(truncatedPlan).toHaveLength(PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS);
    expect(truncatedRequest).toHaveLength(PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS);
    expect(truncatedPlan).toContain("[truncated]");
    expect(truncatedRequest).toContain("[truncated]");
    expect(result.prompt).not.toContain("PLAN_TAIL");
    expect(result.prompt).not.toContain("REQUEST_TAIL");
  });
});

describe("buildFetchExplorationPrompt", () => {
  it("gives the main agent first refusal and keeps parallel exploration conservative", () => {
    const result = buildFetchExplorationPrompt({
      userRequest: "Explain how authentication works.",
      repositoryOrientation: "Top-level areas: apps, packages\nTests: apps/server/auth.test.ts",
      maxRecommendedWorkers: 12,
    });

    expect(result.prompt).toContain("Default to decision=skip");
    expect(result.prompt).toContain("main agent can inspect the repository with its own tools");
    expect(result.prompt).toContain("simple, narrow, or briefly investigative requests");
    expect(result.prompt).toContain("asks the main agent to work alone");
    expect(result.prompt).toContain("If uncertain, skip");
    expect(result.prompt).toContain("smallest useful worker count");
    expect(result.prompt).toContain("Never use three workers as a default");
    expect(result.prompt).toContain("between 1 and 12 workers");
    expect(result.prompt).toContain("concrete, non-overlapping");
    expect(result.prompt).toContain("repository-read-only discovery");
    expect(result.prompt).toContain("zero workers");
    expect(result.prompt).toContain("Top-level areas: apps, packages");
    expect(decodeFetchExplorationOutput({ decision: "skip", workers: [] })).toEqual({
      decision: "skip",
      workers: [],
    });
    expect(
      decodeFetchExplorationOutput({
        decision: "run",
        workers: [{ scope: "Authentication contracts", questions: ["Where is auth decoded?"] }],
      }),
    ).toEqual({
      decision: "run",
      workers: [{ scope: "Authentication contracts", questions: ["Where is auth decoded?"] }],
    });
  });

  it("truncates the original request to exactly 16,000 characters with a marker", () => {
    const result = buildFetchExplorationPrompt({
      userRequest: `${"r".repeat(FETCH_EXPLORATION_REQUEST_MAX_CHARS)}REQUEST_TAIL`,
      repositoryOrientation: "Repository orientation",
      maxRecommendedWorkers: 8,
    });

    const requestSection = result.prompt
      .split("Original user request:\n", 2)[1]
      ?.split("\n\nRepository orientation:", 1)[0];
    expect(requestSection).toHaveLength(FETCH_EXPLORATION_REQUEST_MAX_CHARS);
    expect(requestSection).toContain("[truncated]");
    expect(result.prompt).not.toContain("REQUEST_TAIL");
  });
});

describe("sanitizeThreadTitle", () => {
  it("truncates long titles with the shared sidebar-safe limit", () => {
    expect(
      sanitizeThreadTitle(
        '  "Reconnect failures after restart because the session state does not recover"  ',
      ),
    ).toBe("Reconnect failures after restart because the se...");
  });
});

describe("normalizeCliError", () => {
  it("detects 'Command not found' and includes CLI name in the message", () => {
    const error = normalizeCliError(
      "claude",
      "generateCommitMessage",
      new Error("Command not found: claude"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Claude CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("uses the CLI name from the first argument for codex", () => {
    const error = normalizeCliError(
      "codex",
      "generateBranchName",
      new Error("Command not found: codex"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Codex CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("returns the error as-is if it is already a TextGenerationError", () => {
    const existing = new TextGenerationError({
      operation: "generatePrContent",
      detail: "Already wrapped",
    });

    const result = normalizeCliError("claude", "generatePrContent", existing, "fallback");

    expect(result).toBe(existing);
  });

  it("wraps unknown non-Error values with the fallback message", () => {
    const result = normalizeCliError("codex", "generateCommitMessage", "string error", "fallback");

    expect(result).toBeInstanceOf(TextGenerationError);
    expect(result.detail).toBe("fallback");
  });

  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});
