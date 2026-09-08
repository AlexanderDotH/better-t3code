import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  makeAlreadyLocalProviderHistorySync,
  makeInstanceHistorySyncSource,
  makeSupportedProviderHistorySync,
  makeUnsupportedProviderHistorySync,
  type ProviderHistorySyncAdapter,
  type ProviderHistorySyncSource,
} from "./ProviderHistorySync.ts";

const source: ProviderHistorySyncSource = {
  sourceId: "codex-home:work",
  continuationKey: "codex:home:/work/codex",
  displayName: "Codex Work",
  capabilities: {
    search: true,
    archived: true,
    resume: true,
    activity: true,
  },
};

const adapter: ProviderHistorySyncAdapter = {
  list: () =>
    Effect.succeed({
      items: [],
      nextCursor: undefined,
      totalMatching: 0,
      latestUpdatedAt: undefined,
    }),
  read: ({ sessionId }) =>
    Effect.succeed({
      sessionId,
      items: [],
      updatedAt: "2026-08-23T12:00:00.000Z",
    }),
  resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { threadId: sessionId } }),
  checkActivity: () => Effect.succeed("idle"),
};

describe("ProviderHistorySync facet", () => {
  it("keeps supported history operations behind the supported discriminant", () => {
    const facet = makeSupportedProviderHistorySync({ source, adapter });

    expect(facet).toEqual({ availability: "supported", source, adapter });
  });

  it("reports an unsupported harness without partial adapter methods", () => {
    const facet = makeUnsupportedProviderHistorySync({
      source,
      reason: "The harness does not expose historical sessions.",
    });

    expect(facet).toEqual({
      availability: "unsupported",
      source,
      reason: "The harness does not expose historical sessions.",
    });
  });

  it("reports T3-owned history as already local", () => {
    const facet = makeAlreadyLocalProviderHistorySync({
      source,
      reason: "Gemini history is already stored by T3 Code.",
    });

    expect(facet).toEqual({
      availability: "already-local",
      source,
      reason: "Gemini history is already stored by T3 Code.",
    });
  });
});

describe("ProviderHistorySync source identity", () => {
  it("remains independent from the provider instance routing identity", () => {
    const instanceId = ProviderInstanceId.make("codex-work");
    const driverKind = ProviderDriverKind.make("codex");

    expect(instanceId).toBe("codex-work");
    expect(driverKind).toBe("codex");
    expect(source.continuationKey).toBe("codex:home:/work/codex");
  });

  it("uses one stable source id for instances sharing a continuation key", () => {
    const driverKind = ProviderDriverKind.make("codex");
    const continuationKey = "codex:home:shared";
    const makeSource = (instanceId: string) =>
      makeInstanceHistorySyncSource({
        driverKind,
        instanceId: ProviderInstanceId.make(instanceId),
        continuationKey,
        displayName: "Codex",
        capabilities: source.capabilities,
      });

    expect(makeSource("codex-personal").sourceId).toBe(makeSource("codex-work").sourceId);
    expect(makeSource("codex-personal").sourceId).toBe("codex:history:codex:home:shared");
  });
});
