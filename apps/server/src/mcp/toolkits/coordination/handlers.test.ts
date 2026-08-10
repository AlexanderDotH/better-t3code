import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  ProjectAgentCoordinator,
  type ProjectAgentCoordinatorShape,
} from "../../../projectAgent/ProjectAgentCoordinator.ts";
import { invokeProjectAgentList } from "./handlers.ts";

const threadId = ThreadId.make("thread-coordination-handler");
const coordinator = ProjectAgentCoordinator.of({
  list: (authenticatedThreadId) =>
    Effect.succeed({
      peers: [
        {
          threadId: authenticatedThreadId,
          self: true,
          phase: "working",
          title: "Authenticated agent",
          model: "gpt-5.6",
          branch: null,
          worktreePath: null,
          summary: null,
          claims: [],
          unreadCount: 0,
        },
      ],
      truncated: false,
    }),
  claim: () => Effect.die("unused"),
  send: () => Effect.die("unused"),
  inbox: () => Effect.die("unused"),
} satisfies ProjectAgentCoordinatorShape);

const invocation = (capabilities: ReadonlySet<McpInvocationContext.McpCapability>) => ({
  environmentId: EnvironmentId.make("environment-coordination-handler"),
  threadId,
  providerSessionId: "provider-session-coordination-handler",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

it.effect("derives project-agent identity from the authenticated MCP credential", () =>
  Effect.gen(function* () {
    const result = yield* invokeProjectAgentList();
    expect(result.peers[0]?.threadId).toBe(threadId);
  }).pipe(
    Effect.provideService(ProjectAgentCoordinator, coordinator),
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["coordination"])),
    ),
  ),
);

it.effect("rejects credentials without the coordination capability", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(invokeProjectAgentList());
    expect(error.reason).toBe("credential_not_authorized");
  }).pipe(
    Effect.provideService(ProjectAgentCoordinator, coordinator),
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview"])),
    ),
  ),
);
