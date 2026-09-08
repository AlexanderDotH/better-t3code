import { CommandId, EventId, ProjectId, type OrchestrationEvent } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-checkpoints-enabled");

const seedProjectCreated = (sequence: number): OrchestrationEvent => ({
  sequence,
  eventId: EventId.make(`evt-project-checkpoints-enabled-${sequence}`),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "project.created",
  occurredAt: now,
  commandId: CommandId.make(`cmd-project-checkpoints-enabled-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`cmd-project-checkpoints-enabled-${sequence}`),
  metadata: {},
  payload: {
    projectId,
    title: "Checkpoint setting",
    workspaceRoot: "/tmp/checkpoint-setting",
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  },
});

it.layer(NodeServices.layer)("decider project checkpointsEnabled", (it) => {
  it.effect("defaults legacy projects to enabled and propagates an explicit disable", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));
      expect(readModel.projects[0]?.checkpointsEnabled).toBe(true);

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-checkpoints-disable"),
          projectId,
          checkpointsEnabled: false,
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.meta-updated");
      expect((event.payload as { checkpointsEnabled?: unknown }).checkpointsEnabled).toBe(false);

      const updated = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(updated.projects[0]?.checkpointsEnabled).toBe(false);
    }),
  );

  it.effect("leaves the setting unchanged when an unrelated project field is updated", () =>
    Effect.gen(function* () {
      const readModel = yield* projectEvent(createEmptyReadModel(now), seedProjectCreated(1));
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-checkpoints-title"),
          projectId,
          title: "Renamed",
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect("checkpointsEnabled" in (event.payload as object)).toBe(false);

      const updated = yield* projectEvent(readModel, { ...event, sequence: 2 });
      expect(updated.projects[0]?.checkpointsEnabled).toBe(true);
    }),
  );
});
