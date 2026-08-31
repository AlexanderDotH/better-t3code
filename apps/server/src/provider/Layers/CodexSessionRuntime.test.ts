import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe } from "vite-plus/test";
import { DEFAULT_MODEL, McpServerDefinition, SubagentId, ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexDeveloperInstructions,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
  codexDefaultModeDeveloperInstructions,
  codexPlanModeDeveloperInstructions,
} from "../CodexDeveloperInstructions.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import {
  buildTurnStartParams,
  compactCodexThread,
  codexNotificationProviderRoute,
  configuredT3ToolAvailability,
  describeMcpElicitation,
  forkCodexThread,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  listCodexMcpServerStatuses,
  makeCodexSubagentId,
  makeMemoryConsolidationNotificationFilter,
  openCodexThread,
  requestCodexMcpOauth,
  toMcpElicitationResponse,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);
const decodeMcpServerDefinition = Schema.decodeSync(McpServerDefinition);

describe("CodexSessionRuntimeIdentifierGenerationError", () => {
  it("retains identifier purpose and the random source failure", () => {
    const cause = new Error("random source unavailable");
    const error = new CodexErrors.CodexAppServerIdentifierGenerationError({
      purpose: "provider-event",
      cause,
    });

    NodeAssert.equal(error.purpose, "provider-event");
    NodeAssert.strictEqual(error.cause, cause);
    NodeAssert.equal(
      error.message,
      "Failed to generate Codex App Server identifier for provider-event.",
    );
  });
});

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("keeps invalid turn values only in the schema cause", () => {
    const secret = "codex-turn-input-secret-sentinel";
    const error = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        attachments: [
          {
            type: "image",
            url: { secret } as unknown as string,
          },
        ],
      }).pipe(Effect.flip),
    );
    const { cause, ...directDiagnostics } = error;

    NodeAssert.equal(error.operation, "decode-request-payload");
    NodeAssert.equal(error.method, "turn/start");
    NodeAssert.ok((error.issueCount ?? 0) > 0);
    NodeAssert.ok(error.issueKinds?.includes("Pointer"));
    NodeAssert.ok((error.maximumPathDepth ?? 0) > 0);
    NodeAssert.ok(Schema.isSchemaError(cause));
    NodeAssert.doesNotMatch(error.message, new RegExp(secret));
    NodeAssert.doesNotMatch(JSON.stringify(directDiagnostics), new RegExp(secret));
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("plan", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("default", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("reports the same fallback model and effort in settings and instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Go",
        interactionMode: "default",
      }),
    );

    const settings = params.collaborationMode?.settings;
    NodeAssert.equal(settings?.model, DEFAULT_MODEL);
    NodeAssert.equal(settings?.reasoning_effort, "medium");
    NodeAssert.ok(settings?.developer_instructions?.includes(`as ${DEFAULT_MODEL} with medium`));
  });

  it.effect("routes approvals to the auto reviewer in auto mode", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto",
        prompt: "Ship it",
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        input: [
          {
            type: "text",
            text: "Ship it",
          },
        ],
      });
    }),
  );

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("Codex MCP elicitation approvals", () => {
  const request = {
    mode: "form",
    message: "Allow ChatGPT to use Safari?",
    serverName: "computer-use",
    threadId: "provider-thread-1",
    turnId: "turn-1",
    _meta: {
      app_name: "Safari",
      persist: ["session", "always"],
    },
    requestedSchema: {
      type: "object",
      properties: {
        approval: {
          type: "string",
          oneOf: [
            { const: "once", title: "Allow once" },
            { const: "session", title: "Allow for this session" },
            { const: "always", title: "Always allow Safari" },
          ],
        },
      },
      required: ["approval"],
    },
  } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

  it("preserves the app name and advertised persistence choices", () => {
    NodeAssert.deepStrictEqual(describeMcpElicitation(request), {
      appName: "Safari",
      options: [
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
        { decision: "acceptForSession", label: "Allow for this session" },
        { decision: "acceptAlways", label: "Always allow Safari" },
        { decision: "accept", label: "Approve" },
      ],
    });
  });

  it("extracts the app name from a Computer Use request without metadata", () => {
    const { _meta, ...requestWithoutMetadata } = request;

    NodeAssert.equal(describeMcpElicitation(requestWithoutMetadata).appName, "Safari");
  });

  it("returns the accepted form option to Codex", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "accept"), {
      action: "accept",
      content: { approval: "once" },
    });
  });

  it("returns session-scoped approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptForSession"), {
      action: "accept",
      _meta: { persist: "session" },
      content: { approval: "session" },
    });
  });

  it("returns persistent approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("returns rejection without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "decline"), {
      action: "decline",
    });
  });

  it("returns cancellation without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "cancel"), {
      action: "cancel",
    });
  });

  it("supports boolean permanent-approval fields", () => {
    const booleanRequest = {
      ...request,
      _meta: { app_name: "Safari" },
      requestedSchema: {
        type: "object",
        properties: {
          always: { type: "boolean", title: "Always allow Safari" },
        },
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.ok(
      describeMcpElicitation(booleanRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(booleanRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { always: true },
    });
  });

  it("preserves valid nullable MCP form fields and persistence choices", () => {
    const nullableRequest = {
      ...request,
      _meta: {
        app_name: null,
        appName: "Safari",
        connector_name: null,
        persist: null,
        target: null,
        tool_params: null,
      },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            title: null,
            description: null,
            default: null,
            enum: ["once", "always"],
            enumNames: null,
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.equal(describeMcpElicitation(nullableRequest).appName, "Safari");
    NodeAssert.ok(
      describeMcpElicitation(nullableRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(nullableRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("declines required form fields that an approval prompt cannot collect", () => {
    const inputRequest = {
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
        },
        required: ["email"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(inputRequest, "accept"), {
      action: "decline",
    });
  });

  it("does not approve URL elicitations without opening their requested URL", () => {
    const urlRequest = {
      mode: "url",
      message: "Finish signing in to continue.",
      serverName: "computer-use",
      threadId: "provider-thread-1",
      turnId: "turn-1",
      elicitationId: "sign-in-1",
      url: "https://example.com/authorize",
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(urlRequest, "accept"), {
      action: "decline",
    });
  });

  it("omits persistence choices that cannot satisfy required form fields", () => {
    const onceOnlyRequest = {
      ...request,
      _meta: { app_name: "Safari", persist: ["session", "always"] },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            enum: ["once"],
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(describeMcpElicitation(onceOnlyRequest).options, [
      { decision: "cancel", label: "Cancel" },
      { decision: "decline", label: "Decline" },
      { decision: "accept", label: "Approve" },
    ]);
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("appends runtime info after the mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    NodeAssert.ok(instructions.startsWith(codexDefaultModeDeveloperInstructions(true)));
    NodeAssert.match(instructions, /T3 Code/);
    NodeAssert.match(instructions, /Codex harness/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with high reasoning effort/);
  });

  it("includes runtime info alongside plan mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("plan", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    NodeAssert.ok(instructions.startsWith(codexPlanModeDeveloperInstructions(true)));
    NodeAssert.match(instructions, /as gpt-5\.3-codex with medium reasoning effort/);
  });

  it("varies with the model and effort of each turn", () => {
    const first = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
    const second = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    NodeAssert.notEqual(first, second);
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("T3 browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      codexDefaultModeDeveloperInstructions(true),
      codexPlanModeDeveloperInstructions(true),
    ]) {
      NodeAssert.match(instructions, /T3 browser/);
      NodeAssert.match(instructions, /preview_status/);
      NodeAssert.match(instructions, /open a preview/i);
      NodeAssert.match(instructions, /before switching browser systems/i);
    }
  });

  it("keeps collaboration guidance and concise workspace-tool preferences", () => {
    NodeAssert.match(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS, /concise by default/);
    NodeAssert.match(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS, /complete replacement/);
    NodeAssert.match(
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      /request_user_input.*listed in the available tools/,
    );

    for (const instructions of [
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      NodeAssert.match(instructions, /workspace_context/);
      NodeAssert.doesNotMatch(instructions, /then use bounded.*rg/i);
      NodeAssert.doesNotMatch(instructions, /reuse.*results/i);
    }
    NodeAssert.match(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS, /workspace_edit/);
    NodeAssert.doesNotMatch(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS, /workspace_edit/);
  });

  it("omits the browser block entirely when the preview tools are not attached", () => {
    for (const instructions of [
      codexDefaultModeDeveloperInstructions(false),
      codexPlanModeDeveloperInstructions(false),
    ]) {
      NodeAssert.doesNotMatch(instructions, /preview_status/);
      NodeAssert.doesNotMatch(instructions, /preview_open/);
      NodeAssert.doesNotMatch(instructions, /T3 Code collaborative browser/);
      // Steering away from other browser automation must go with the tools;
      // keeping it would leave the model talked out of its only option.
      NodeAssert.doesNotMatch(instructions, /Do not switch to global browser skills/);
      // The collaboration mode remains valid while unavailable toolkits stay absent.
      NodeAssert.match(instructions, /<collaboration_mode>/);
      NodeAssert.match(instructions, /<\/collaboration_mode>/);
      NodeAssert.doesNotMatch(instructions, /workspace_context/);
    }
  });

  it("tracks the turn's MCP configuration rather than defaulting to on", () => {
    const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };
    NodeAssert.match(buildCodexDeveloperInstructions("default", runtime, true), /preview_status/);
    NodeAssert.doesNotMatch(
      buildCodexDeveloperInstructions("default", runtime, false),
      /preview_status/,
    );
  });
});

describe("configuredT3ToolAvailability", () => {
  it("announces only toolkits attached by the selected endpoint profile", () => {
    NodeAssert.deepEqual(configuredT3ToolAvailability(undefined), {
      preview: false,
      workspace: false,
      workspaceWrite: false,
      coordination: false,
      threadContext: false,
      projectMemory: false,
      knowledgeGraph: false,
    });
    NodeAssert.deepEqual(
      configuredT3ToolAvailability([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-no-preview"',
      ]),
      {
        preview: false,
        workspace: true,
        workspaceWrite: false,
        coordination: true,
        threadContext: true,
        projectMemory: true,
        knowledgeGraph: true,
      },
    );
    NodeAssert.deepEqual(
      configuredT3ToolAvailability([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-only"',
      ]),
      {
        preview: false,
        workspace: true,
        workspaceWrite: false,
        coordination: false,
        threadContext: true,
        projectMemory: true,
        knowledgeGraph: false,
      },
    );
    NodeAssert.deepEqual(
      configuredT3ToolAvailability([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-only-no-memory"',
      ]),
      {
        preview: false,
        workspace: true,
        workspaceWrite: false,
        coordination: false,
        threadContext: true,
        projectMemory: false,
        knowledgeGraph: false,
      },
    );
    NodeAssert.deepEqual(
      configuredT3ToolAvailability([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-write-no-preview"',
      ]),
      {
        preview: false,
        workspace: true,
        workspaceWrite: true,
        coordination: true,
        threadContext: true,
        projectMemory: true,
        knowledgeGraph: true,
      },
    );
    NodeAssert.deepEqual(
      configuredT3ToolAvailability([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-write-only-no-memory"',
      ]),
      {
        preview: false,
        workspace: true,
        workspaceWrite: true,
        coordination: false,
        threadContext: true,
        projectMemory: false,
        knowledgeGraph: false,
      },
    );
  });
});

describe("hasConfiguredMcpServer", () => {
  it("distinguishes preview-capable and preview-free T3 MCP endpoint profiles", () => {
    NodeAssert.equal(hasConfiguredMcpServer(undefined), false);
    NodeAssert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.t3-code.url="http://127.0.0.1/mcp"']),
      true,
    );
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace"']),
      true,
    );
    NodeAssert.equal(
      hasConfiguredMcpServer([
        "-c",
        'mcp_servers.t3-code.url="http://127.0.0.1/mcp/workspace-write"',
      ]),
      true,
    );
    for (const profile of [
      "workspace-no-preview",
      "coordination",
      "workspace-only",
      "workspace-no-preview-no-memory",
      "workspace-only-no-memory",
      "workspace-write-no-preview",
      "workspace-write-no-preview-no-memory",
      "workspace-write-only",
      "workspace-write-only-no-memory",
    ]) {
      NodeAssert.equal(
        hasConfiguredMcpServer(["-c", `mcp_servers.t3-code.url="http://127.0.0.1/mcp/${profile}"`]),
        false,
      );
    }
  });
});

describe("listCodexMcpServerStatuses", () => {
  it.effect("follows every pagination cursor while preserving thread and detail filters", () =>
    Effect.gen(function* () {
      const requests: Array<CodexRpc.ClientRequestParamsByMethod["mcpServerStatus/list"]> = [];
      const responses: Array<CodexRpc.ClientRequestResponsesByMethod["mcpServerStatus/list"]> = [
        {
          data: [
            {
              authStatus: "oAuth",
              name: "notion",
              resourceTemplates: [],
              resources: [],
              serverInfo: null,
              tools: {},
            },
          ],
          nextCursor: "page-2",
        },
        {
          data: [
            {
              authStatus: "bearerToken",
              name: "github",
              resourceTemplates: [],
              resources: [],
              serverInfo: null,
              tools: {},
            },
          ],
          nextCursor: null,
        },
      ];

      const statuses = yield* listCodexMcpServerStatuses(
        (params) =>
          Effect.sync(() => {
            requests.push(params);
            const response = responses.shift();
            NodeAssert.ok(response);
            return response;
          }),
        {
          threadId: "provider-thread-1",
          detail: "full",
        },
      );

      NodeAssert.deepStrictEqual(
        statuses.map((status) => status.name),
        ["notion", "github"],
      );
      NodeAssert.deepStrictEqual(requests, [
        {
          threadId: "provider-thread-1",
          detail: "full",
        },
        {
          threadId: "provider-thread-1",
          detail: "full",
          cursor: "page-2",
        },
      ]);
    }),
  );
});

describe("requestCodexMcpOauth", () => {
  it.effect("scopes authorization to the exact provider thread and server", () =>
    Effect.gen(function* () {
      let requested: CodexRpc.ClientRequestParamsByMethod["mcpServer/oauth/login"] | undefined;
      const response = yield* requestCodexMcpOauth(
        (params) => {
          requested = params;
          return Effect.succeed({ authorizationUrl: "https://auth.example.test/authorize" });
        },
        {
          providerThreadId: "provider-thread-1",
          serverName: "notion",
          scopes: ["search", "read"],
        },
      );

      NodeAssert.deepStrictEqual(requested, {
        name: "notion",
        threadId: "provider-thread-1",
        scopes: ["search", "read"],
      });
      NodeAssert.equal(response.authorizationUrl, "https://auth.example.test/authorize");
    }),
  );
});

function makeThreadStartedNotification(
  threadId: string,
  source: EffectCodexSchema.V2ThreadStartedNotification["thread"]["source"],
  threadSource?: string,
) {
  return {
    method: "thread/started" as const,
    params: {
      thread: {
        cliVersion: "0.0.0",
        createdAt: 0,
        cwd: "/tmp/project",
        ephemeral: true,
        id: threadId,
        modelProvider: "openai",
        preview: "",
        sessionId: threadId,
        source,
        status: { type: "idle" as const },
        ...(threadSource ? { threadSource } : {}),
        turns: [],
        updatedAt: 0,
      },
    },
  };
}

describe("makeMemoryConsolidationNotificationFilter", () => {
  it("suppresses memory consolidation without hiding other Codex subagents", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
      ),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "internal memory update",
          itemId: "memory-message",
          threadId: "memory-thread",
          turnId: "memory-turn",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "serverRequest/resolved",
        params: {
          requestId: "memory-approval",
          threadId: "memory-thread",
        },
      }),
      false,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "warning",
        params: {
          message: "internal warning",
          threadId: "memory-thread",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "normal reply",
          itemId: "root-message",
          threadId: "root-thread",
          turnId: "root-turn",
        },
      }),
      false,
    );

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("legacy-memory-thread", {
          subAgent: "memory_consolidation",
        }),
      ),
      true,
    );

    for (const source of [
      { subAgent: "review" as const },
      { subAgent: "compact" as const },
      {
        subAgent: {
          thread_spawn: {
            depth: 1,
            parent_thread_id: "root-thread",
          },
        },
      },
    ]) {
      NodeAssert.equal(
        shouldSuppress(makeThreadStartedNotification("visible-subagent", source)),
        false,
      );
    }
  });

  it("forgets memory consolidation threads after they close", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();
    shouldSuppress(
      makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
    );

    NodeAssert.equal(
      shouldSuppress({
        method: "thread/closed",
        params: { threadId: "memory-thread" },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "later message",
          itemId: "later-message",
          threadId: "memory-thread",
          turnId: "later-turn",
        },
      }),
      false,
    );
  });
});

describe("codexSessionAppServerArgs", () => {
  it("keeps the app-server subcommand when explicit args are provided", () => {
    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", "model=gpt-5"], undefined), [
      "app-server",
      "-c",
      "model=gpt-5",
    ]);
  });

  it("keeps launch args when explicit app-server args are provided", () => {
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(
        ["-c", "mcp_servers.t3-code.url=http://127.0.0.1/mcp"],
        "--strict-config --enable foo",
      ),
      [
        "app-server",
        "--strict-config",
        "--enable",
        "foo",
        "-c",
        "mcp_servers.t3-code.url=http://127.0.0.1/mcp",
      ],
    );
  });

  it("passes narrow and explicit optional T3 profiles to the Codex runtime unchanged", () => {
    const profileArg = (
      profile: "workspace-only" | "workspace-no-preview" | "workspace-only-no-memory",
    ) => `mcp_servers.t3-code.url=http://127.0.0.1/mcp/${profile}`;

    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", profileArg("workspace-only")]), [
      "app-server",
      "-c",
      profileArg("workspace-only"),
    ]);
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(["-c", profileArg("workspace-no-preview")]),
      ["app-server", "-c", profileArg("workspace-no-preview")],
    );
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(["-c", profileArg("workspace-only-no-memory")]),
      ["app-server", "-c", profileArg("workspace-only-no-memory")],
    );
  });
});

describe("Codex notification provider routing", () => {
  it("tags child notifications from their provider thread without rewriting their route", () => {
    const route = codexNotificationProviderRoute("provider-root", {
      method: "item/started",
      params: {
        threadId: "provider-child",
        turnId: "child-turn",
        item: {
          id: "child-item",
          type: "agentMessage",
          text: "",
        },
      },
    });

    NodeAssert.deepStrictEqual(route, {
      providerThreadId: "provider-child",
      subagentId: SubagentId.make("codex:provider-child"),
    });
  });

  it("reads child thread ids from thread metadata notifications", () => {
    const route = codexNotificationProviderRoute("provider-root", {
      method: "thread/started",
      params: {
        thread: {
          id: "provider-child",
        },
      },
    });

    NodeAssert.deepStrictEqual(route, {
      providerThreadId: "provider-child",
      subagentId: makeCodexSubagentId("provider-child"),
    });
  });

  it("keeps root notifications untagged while retaining the provider thread id", () => {
    const route = codexNotificationProviderRoute("provider-root", {
      method: "turn/started",
      params: {
        threadId: "provider-root",
        turn: {
          id: "root-turn",
        },
      },
    });

    NodeAssert.deepStrictEqual(route, {
      providerThreadId: "provider-root",
    });
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("matches a missing rollout for a known thread id", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "no rollout found for thread id 019fdf74-aaa9-7950-b252-7cc7a8650470",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it.effect("preserves reasoning and compacts body context before the window is exhausted", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };

      yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.6-sol",
        contextWindow: 262_144,
        reasoningEffort: "high",
        serviceTier: undefined,
        resumeThreadId: undefined,
      });

      const request = calls[0];
      NodeAssert.ok(request);
      NodeAssert.deepStrictEqual(
        (request.payload as { readonly config?: Readonly<Record<string, unknown>> }).config,
        {
          model_context_window: 262_144,
          model_auto_compact_token_limit: 209_715,
          model_auto_compact_token_limit_scope: "body_after_prefix",
          model_reasoning_effort: "high",
        },
      );
    }),
  );

  it.effect("keeps the built-in T3 server when configured MCP servers override thread config", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };
      const userManagedT3Server = decodeMcpServerDefinition({
        id: "t3-code",
        name: "User T3 server",
        transport: "http",
        url: "https://user-mcp.example/mcp",
        headers: {},
      });

      yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        contextWindow: 262_144,
        serviceTier: undefined,
        resumeThreadId: undefined,
        mcpServers: [userManagedT3Server],
        internalMcpServer: {
          url: "http://127.0.0.1:3000/mcp/workspace",
          bearerTokenEnvVar: "T3_MCP_BEARER_TOKEN",
        },
      });

      const firstCall = calls[0];
      NodeAssert.ok(firstCall);
      const config = (
        firstCall.payload as {
          readonly config?: {
            readonly mcp_servers?: Readonly<Record<string, unknown>>;
            readonly model_context_window?: number;
          };
        }
      ).config;
      NodeAssert.equal(config?.model_context_window, 262_144);
      const mcpServers = config?.mcp_servers;
      NodeAssert.ok(mcpServers);
      NodeAssert.equal(Object.hasOwn(mcpServers, "t3-managed:t3-code"), true);
      NodeAssert.deepStrictEqual(mcpServers["t3-code"], {
        url: "http://127.0.0.1:3000/mcp/workspace",
        bearer_token_env_var: "T3_MCP_BEARER_TOKEN",
      });
    }),
  );

  it.effect("falls back to thread/start when resume fails recoverably", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const started = makeThreadOpenResponse("fresh-thread");
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          }
          return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        contextWindow: 524_288,
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      NodeAssert.equal(opened.thread.id, "fresh-thread");
      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
      for (const call of calls) {
        NodeAssert.equal(
          (call.payload as { readonly config?: { readonly model_context_window?: number } }).config
            ?.model_context_window,
          524_288,
        );
      }
    }),
  );

  it.effect("propagates non-recoverable resume failures", () =>
    Effect.gen(function* () {
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          _payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "timed out waiting for server",
              }),
            );
          }
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };

      const error = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }).pipe(Effect.flip);

      NodeAssert.ok(isCodexAppServerRequestError(error));
      NodeAssert.equal(error.errorMessage, "timed out waiting for server");
    }),
  );
});

describe("Codex native thread lifecycle", () => {
  it.effect("forks through the requested provider turn without serializing a transcript", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly method: string; readonly payload: unknown }> = [];
      const result = yield* forkCodexThread({
        client: {
          request: (method, payload) => {
            requests.push({ method, payload });
            return Effect.succeed({
              model: "gpt-5.6-sol",
              reasoningEffort: "high",
              thread: { id: "provider-child" },
            } as CodexRpc.ClientRequestResponsesByMethod["thread/fork"]);
          },
        },
        sourceProviderThreadId: "provider-parent",
        lastProviderTurnId: "provider-turn-7",
      });
      yield* forkCodexThread({
        client: {
          request: (method, payload) => {
            requests.push({ method, payload });
            return Effect.succeed({
              model: "gpt-5.6-sol",
              thread: { id: "provider-child-latest" },
            } as CodexRpc.ClientRequestResponsesByMethod["thread/fork"]);
          },
        },
        sourceProviderThreadId: "provider-parent",
      });

      NodeAssert.deepStrictEqual(requests, [
        {
          method: "thread/fork",
          payload: {
            threadId: "provider-parent",
            lastTurnId: "provider-turn-7",
          },
        },
        {
          method: "thread/fork",
          payload: { threadId: "provider-parent" },
        },
      ]);
      NodeAssert.deepStrictEqual(result, {
        threadId: "provider-child",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      });
    }),
  );

  it.effect("treats a native compaction request failure as nonfatal", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly method: string; readonly payload: unknown }> = [];

      yield* compactCodexThread({
        client: {
          request: (method, payload) => {
            requests.push({ method, payload });
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "compaction unavailable",
              }),
            );
          },
        },
        providerThreadId: "provider-thread-1",
      });

      NodeAssert.deepStrictEqual(requests, [
        {
          method: "thread/compact/start",
          payload: { threadId: "provider-thread-1" },
        },
      ]);
    }),
  );
});
