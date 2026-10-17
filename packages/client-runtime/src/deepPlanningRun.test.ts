import {
  CommandId,
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { deepPlanCitationTitles, formatDeepPlanForDisplay } from "./deepPlanningPresentation.ts";

import {
  approveDeepPlanImplementation,
  buildDeepPlanFinalValidationPrompt,
  buildDeepPlanImplementationPrompt,
  formatDeepPlanMarkdown,
  getApprovedDeepPlanReference,
  getDeepPlanApprovalBlockReason,
  getDeepPlanProposalBlockReason,
  selectDeepPlanProgress,
  selectDeepPlanSteps,
  selectDurableDeepPlan,
} from "./deepPlanningRun.ts";

const threadId = ThreadId.make("owner");
const implementationThreadId = ThreadId.make("implementation");
const environmentId = EnvironmentId.make("environment");
const createdAt = "2026-10-16T08:00:00.000Z";
const implementation = { instanceId: ProviderInstanceId.make("provider"), model: "model" };
const evidence = [{ kind: "test" as const, summary: "Focused checks passed", createdAt }];
const provider: ServerProvider = {
  ...implementation,
  driver: ProviderDriverKind.make("custom"),
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: createdAt,
  version: null,
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 8 },
  models: [],
  slashCommands: [],
  skills: [],
};

function run(overrides?: Partial<DeepPlanRun>): DeepPlanRun {
  return {
    id: DeepPlanRunId.make("run"),
    threadId,
    phase: "implementing",
    revision: 4,
    plan: {
      schemaVersion: 1,
      version: 2,
      goal: "Ship the complete workflow",
      scope: ["Both clients"],
      decisions: [{ id: "decision", text: "Persist the approved version" }],
      affectedAreas: ["Client runtime"],
      steps: [
        {
          id: "build",
          title: "Build",
          description: "Implement the approved scope",
          dependencies: [],
          acceptanceCriteria: [
            { id: "build-check", description: "Feature works", checkMethod: "Run focused tests" },
          ],
        },
        {
          id: "verify",
          title: "Verify",
          description: "Inspect the complete integration",
          dependencies: ["build"],
          acceptanceCriteria: [
            {
              id: "verify-check",
              description: "Clients agree",
              checkMethod: "Inspect both clients",
            },
          ],
        },
      ],
      finalValidation: {
        description: "Validate the entire implementation",
        checkMethod: "Run the final integration checks",
      },
    },
    approvalKey: "revision-2-key",
    approval: {
      planVersion: 2,
      approvalKey: "revision-2-key",
      approvedAt: createdAt,
      approvedBy: "user",
      implementation,
      implementationThreadId,
      implementerId: `thread:${implementationThreadId}`,
    },
    sources: [],
    sourceCoverage: [],
    stepStates: [],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt,
    updatedAt: createdAt,
    pauseReason: null,
    ...overrides,
  };
}

describe("DeepPlan durable client state", () => {
  it("resolves owner and implementation threads without crossing environments", () => {
    const plan = run();
    const owner = { id: threadId, environmentId, deepPlan: plan };
    expect(selectDurableDeepPlan(owner)).toBe(plan);
    expect(selectDurableDeepPlan({ id: implementationThreadId, environmentId }, [owner])).toBe(
      plan,
    );
    expect(
      selectDurableDeepPlan({ id: implementationThreadId, environmentId, deepPlan: plan }),
    ).toBe(plan);
    expect(
      selectDurableDeepPlan(
        { id: implementationThreadId, environmentId: EnvironmentId.make("other") },
        [owner],
      ),
    ).toBeNull();
    expect(selectDurableDeepPlan({ id: ThreadId.make("unrelated"), deepPlan: plan })).toBeNull();
  });

  it("keeps missing steps pending and dependencies blocked until verified", () => {
    const pending = selectDeepPlanSteps(run());
    expect(pending[0]).toMatchObject({ status: "pending", canStart: true });
    expect(pending[1]).toMatchObject({
      status: "pending",
      canStart: false,
      blockedByDependencies: ["build"],
    });
    const afterBuild = selectDeepPlanSteps(
      run({
        stepStates: [{ stepId: "build", status: "verified", evidence, updatedAt: createdAt }],
      }),
    );
    expect(afterBuild[1]).toMatchObject({ canStart: true, blockedByDependencies: [] });
  });

  it("does not equate implemented work or stale approval with completion", () => {
    const plan = run();
    const stepStates = plan.plan!.steps.map((step) => ({
      stepId: step.id,
      status: "implemented" as const,
      evidence,
      updatedAt: createdAt,
    }));
    expect(selectDeepPlanProgress({ ...plan, stepStates })).toMatchObject({
      implementedSteps: 2,
      verifiedSteps: 0,
      completed: false,
    });
    const verified = stepStates.map((state) => ({ ...state, status: "verified" as const }));
    const completed = {
      ...plan,
      phase: "completed" as const,
      stepStates: verified,
      finalValidation: { ...plan.finalValidation, status: "passed" as const, evidence },
    };
    expect(selectDeepPlanProgress(completed).completed).toBe(true);
    expect(selectDeepPlanProgress({ ...completed, approvalKey: "new-key" }).completed).toBe(false);
    expect(
      selectDeepPlanProgress({
        ...completed,
        finalValidation: { ...completed.finalValidation, evidence: [] },
      }).completed,
    ).toBe(false);
  });

  it("requires the exact approved plan version and approval fingerprint", () => {
    expect(getApprovedDeepPlanReference(run())).toEqual({ runId: "run", planVersion: 2 });
    expect(() => getApprovedDeepPlanReference(run({ approval: null }))).toThrow("Approve");
    expect(() => getApprovedDeepPlanReference(run({ approvalKey: "new-key" }))).toThrow("Approve");
    const current = run();
    expect(() =>
      getApprovedDeepPlanReference({ ...current, plan: { ...current.plan!, version: 3 } }),
    ).toThrow("Approve");
  });

  it("requires full source reading and summaries before approval", () => {
    const sourceId = DeepPlanSourceId.make("source");
    const pending = run({
      phase: "awaitingApproval",
      approval: null,
      sources: [
        {
          sourceId,
          origin: { environmentId, projectId: ProjectId.make("project"), threadId },
          projectTitle: "Project",
          threadTitle: "Prior work",
          archived: true,
          capturedAt: createdAt,
          contentVersion: "v1",
          contentHash: "hash",
          messageCount: 1,
          activityCount: 0,
          attachmentCount: 0,
          recordCount: 3,
          forkOrigin: null,
        },
      ],
      sourceCoverage: [
        {
          sourceId,
          status: "ready",
          importedRecordCount: 3,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        },
      ],
    });
    expect(getDeepPlanApprovalBlockReason(pending)).toContain("fully read");
    const summarized = {
      ...pending,
      sourceCoverage: [
        {
          ...pending.sourceCoverage[0]!,
          status: "summarized" as const,
          readRecordCount: 3,
          summary: {
            requirements: ["Complete source context"],
            decisions: [],
            openIssues: [],
            rejectedApproaches: [],
            conflicts: [],
            citedRecordIds: ["record-1"],
          },
        },
      ],
    };
    expect(getDeepPlanApprovalBlockReason(summarized)).toBeNull();
    expect(
      getDeepPlanApprovalBlockReason({
        ...summarized,
        sourceCoverage: [{ ...summarized.sourceCoverage[0]!, readRecordCount: 2 }],
      }),
    ).toContain("fully read");
  });

  it("uses normal plan actions only for the current, fully analyzed Deep Plan revision", () => {
    const ready = run({ phase: "awaitingApproval", approval: null });
    const proposal = { deepPlan: { runId: ready.id, planVersion: ready.plan!.version } };
    expect(getDeepPlanProposalBlockReason({}, null)).toBeNull();
    expect(getDeepPlanProposalBlockReason(proposal, ready)).toBeNull();
    expect(getDeepPlanProposalBlockReason(proposal, null)).toContain("latest version");
    expect(
      getDeepPlanProposalBlockReason(proposal, { ...ready, id: DeepPlanRunId.make("another-run") }),
    ).toContain("latest version");
    expect(
      getDeepPlanProposalBlockReason(proposal, { ...ready, plan: { ...ready.plan!, version: 3 } }),
    ).toContain("latest version");
    expect(getDeepPlanProposalBlockReason(proposal, { ...ready, phase: "implementing" })).toContain(
      "waiting for approval",
    );
    const sourceId = DeepPlanSourceId.make("unread-source");
    expect(
      getDeepPlanProposalBlockReason(proposal, {
        ...ready,
        sources: [
          {
            sourceId,
            origin: { environmentId, projectId: ProjectId.make("project"), threadId },
            projectTitle: "Project",
            threadTitle: "Unread research",
            archived: true,
            capturedAt: createdAt,
            contentVersion: "v1",
            contentHash: "hash",
            messageCount: 1,
            activityCount: 0,
            attachmentCount: 0,
            recordCount: 1,
            forkOrigin: null,
          },
        ],
      }),
    ).toContain("fully read");
  });

  it("preserves structured decisions, source citations, checks and final validation in exported plans", () => {
    const plan = run().plan!;
    const sourceId = DeepPlanSourceId.make("source");
    const markdown = formatDeepPlanMarkdown({
      ...plan,
      decisions: [{ ...plan.decisions[0]!, sources: [{ sourceId, recordIds: ["record-7"] }] }],
    });
    expect(markdown).toContain("Persist the approved version Sources: source (record-7)");
    expect(markdown).toContain("Dependencies: build");
    expect(markdown).toContain("Run focused tests");
    expect(markdown).toContain("Run the final integration checks");
  });

  it("shows chat titles and step titles while keeping internal references in the agent plan", () => {
    const sourceId = DeepPlanSourceId.make("source-internal-1234");
    const current = run();
    const citation = { sourceId, recordIds: ["message-internal-5678"] };
    const plan = {
      ...current.plan!,
      decisions: [{ id: "decision-internal", text: "Reuse the research", sources: [citation] }],
      steps: current.plan!.steps.map((step) => ({
        ...step,
        sources: [citation],
        acceptanceCriteria: step.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          sources: [citation],
        })),
      })),
    };
    const value = run({
      plan,
      sources: [
        {
          sourceId,
          origin: { environmentId, projectId: ProjectId.make("project"), threadId },
          environmentLabel: "Office Mac",
          projectTitle: "Infrastructure",
          threadTitle: "GitLab storage",
          archived: true,
          capturedAt: createdAt,
          contentVersion: "version-internal",
          contentHash: "hash-internal",
          messageCount: 1,
          activityCount: 0,
          attachmentCount: 0,
          recordCount: 1,
          forkOrigin: null,
        },
      ],
    });
    const translator = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    const display = formatDeepPlanForDisplay(value, translator);
    expect(display).toContain("Office Mac / Infrastructure / GitLab storage");
    expect(display).toContain("Abhängig von: Build");
    expect(display).toContain("- [ ] Feature works");
    expect(display).toContain("Prüfung: Run focused tests");
    expect(display).toContain("Run the final integration checks");
    for (const internal of [
      sourceId,
      "message-internal-5678",
      "version-internal",
      "hash-internal",
      "(build)",
      "(build-check)",
    ]) {
      expect(display).not.toContain(internal);
    }
    expect(formatDeepPlanMarkdown(plan)).toContain(`${sourceId} (message-internal-5678)`);
    expect(formatDeepPlanMarkdown(plan)).toContain("Dependencies: build");
    const overview = formatDeepPlanForDisplay(value, translator, { includeImplementation: false });
    expect(overview).toContain("Reuse the research");
    expect(overview).not.toContain("Run focused tests");
    expect(overview).not.toContain("Run the final integration checks");
    expect(deepPlanCitationTitles([citation, citation], value.sources, "Unavailable")).toEqual([
      "Office Mac / Infrastructure / GitLab storage",
    ]);
    expect(
      deepPlanCitationTitles(
        [{ sourceId: DeepPlanSourceId.make("missing"), recordIds: [] }],
        value.sources,
        "Unavailable",
      ),
    ).toEqual(["Unavailable"]);
    expect(formatDeepPlanForDisplay(run({ plan: null }), translator)).toBe("");
  });

  it("preserves normal and exact-count implementation contracts while binding the approved workflow", () => {
    expect(buildDeepPlanImplementationPrompt(run())).toContain("PLEASE IMPLEMENT THIS PLAN:");
    const prompt = buildDeepPlanImplementationPrompt(run(), {
      strategy: { kind: "subagents", count: 8 },
      provider,
    });
    expect(prompt).toContain("spawn exactly 8 direct child subagents");
    expect(prompt).toContain("Subagents must not spawn additional agents");
    expect(prompt).toContain("run run, approved plan version 2");
    expect(prompt).toContain("deep_plan_step_update");
    expect(prompt).toContain("deep_plan_adjust_procedure");
    expect(prompt).toContain("separate final validation");
  });

  it("builds final validation only after every step has recorded verification evidence", () => {
    expect(() => buildDeepPlanFinalValidationPrompt(run())).toThrow("Verify every");
    const current = run();
    const verified = {
      ...current,
      stepStates: current.plan!.steps.map((step) => ({
        stepId: step.id,
        status: "verified" as const,
        evidence,
        updatedAt: createdAt,
      })),
    };
    expect(buildDeepPlanFinalValidationPrompt(verified)).toContain("same requestId");
    expect(buildDeepPlanFinalValidationPrompt(verified)).toContain(
      "Run the final integration checks",
    );
  });
});

describe("DeepPlan approval dispatch", () => {
  const metadata = {
    commandId: CommandId.make("approve-command"),
    operationId: "approve-op",
    createdAt,
  };

  it("approves the latest matching snapshot and confirms the durable model and implementer", async () => {
    const awaiting = run({ phase: "awaitingApproval", approval: null });
    const approved = run();
    const getRun = vi.fn().mockResolvedValueOnce(awaiting).mockResolvedValueOnce(approved);
    const dispatchCommand = vi.fn().mockResolvedValue({});
    expect(
      await approveDeepPlanImplementation({
        run: awaiting,
        implementation,
        implementationThreadId,
        ...metadata,
        getRun,
        dispatchCommand,
      }),
    ).toBe(approved);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        runId: awaiting.id,
        expectedRevision: 4,
        mutation: expect.objectContaining({
          type: "approve",
          planVersion: 2,
          approvalKey: "revision-2-key",
          implementationThreadId,
          implementerId: `thread:${implementationThreadId}`,
          implementation,
        }),
      }),
    );
  });

  it("rejects a revised plan without approving the unseen version", async () => {
    const old = run({ phase: "awaitingApproval", approval: null });
    const latest = { ...old, plan: { ...old.plan!, version: 3 }, approvalKey: "revision-3-key" };
    const dispatchCommand = vi.fn();
    await expect(
      approveDeepPlanImplementation({
        run: old,
        implementation,
        implementationThreadId,
        ...metadata,
        getRun: async () => latest,
        dispatchCommand,
      }),
    ).rejects.toThrow("Review the latest");
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("does not queue an implementation when durable approval is not confirmed", async () => {
    const awaiting = run({ phase: "awaitingApproval", approval: null });
    await expect(
      approveDeepPlanImplementation({
        run: awaiting,
        implementation,
        implementationThreadId,
        ...metadata,
        getRun: async () => awaiting,
        dispatchCommand: async () => ({}),
      }),
    ).rejects.toThrow("not confirmed");
  });
});
