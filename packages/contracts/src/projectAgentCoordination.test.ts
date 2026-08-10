import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  PROJECT_AGENT_MAX_CLAIMS,
  PROJECT_AGENT_MAX_MESSAGE_CHARS,
  ProjectAgentClaimInput,
  ProjectAgentClaimSetInput,
  ProjectAgentInboxInput,
  ProjectAgentMessageSendInput,
  ProjectAgentPhase,
} from "./projectAgentCoordination.ts";

const decodeClaim = Schema.decodeUnknownSync(ProjectAgentClaimInput);
const decodeClaimSet = Schema.decodeUnknownSync(ProjectAgentClaimSetInput);
const decodeMessage = Schema.decodeUnknownSync(ProjectAgentMessageSendInput);
const decodeInbox = Schema.decodeUnknownSync(ProjectAgentInboxInput);
const decodePhase = Schema.decodeUnknownSync(ProjectAgentPhase);

it("decodes bounded path and topic claims", () => {
  expect(decodeClaim({ kind: "path", path: " src/server " })).toEqual({
    kind: "path",
    path: "src/server",
  });
  expect(decodeClaim({ kind: "topic", topic: " database migration " })).toEqual({
    kind: "topic",
    topic: "database migration",
  });
});

it("requires one to sixteen claims for set and accepts release", () => {
  expect(() => decodeClaimSet({ action: "set", summary: "Working", claims: [] })).toThrow();
  expect(() =>
    decodeClaimSet({
      action: "set",
      summary: "Working",
      claims: Array.from({ length: PROJECT_AGENT_MAX_CLAIMS + 1 }, (_, index) => ({
        kind: "topic",
        topic: `topic ${index}`,
      })),
    }),
  ).toThrow();
  expect(decodeClaimSet({ action: "release" })).toEqual({ action: "release" });
});

it("bounds messages and inbox batches", () => {
  expect(
    decodeMessage({
      target: { broadcast: true },
      kind: "request",
      body: "Coordinate the persistence migration",
    }),
  ).toEqual({
    target: { broadcast: true },
    kind: "request",
    body: "Coordinate the persistence migration",
  });
  expect(() =>
    decodeMessage({
      target: { threadId: "thread-peer" },
      kind: "info",
      body: "x".repeat(PROJECT_AGENT_MAX_MESSAGE_CHARS + 1),
    }),
  ).toThrow();
  expect(decodeInbox({})).toEqual({ limit: 20 });
  expect(() => decodeInbox({ limit: 51 })).toThrow();
});

it("represents an inactive peer chat as offline", () => {
  expect(decodePhase("offline")).toBe("offline");
});
