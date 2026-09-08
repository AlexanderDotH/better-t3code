import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { EnvironmentOrchestrationThreadSnapshotQuery } from "./environmentHttp.ts";
import {
  ORCHESTRATION_MAX_THREAD_TURN_LIMIT,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadDetailWindow,
} from "./orchestration.ts";

const decodeSubscribe = Schema.decodeUnknownSync(OrchestrationSubscribeThreadInput);
const decodeWindow = Schema.decodeUnknownSync(OrchestrationThreadDetailWindow);
const decodeHttpQuery = Schema.decodeUnknownSync(
  Schema.Struct(EnvironmentOrchestrationThreadSnapshotQuery),
);

describe("orchestration thread window bounds", () => {
  it("keeps the absent window as the legacy full-snapshot request", () => {
    expect(decodeSubscribe({ threadId: "thread-1" })).toEqual({ threadId: "thread-1" });
    expect(decodeWindow({})).toEqual({});
    expect(decodeHttpQuery({})).toEqual({});
  });

  it("accepts the maximum explicit current-client window on WebSocket and HTTP", () => {
    expect(
      decodeSubscribe({ threadId: "thread-1", turnLimit: ORCHESTRATION_MAX_THREAD_TURN_LIMIT }),
    ).toMatchObject({ turnLimit: ORCHESTRATION_MAX_THREAD_TURN_LIMIT });
    expect(decodeWindow({ turnLimit: ORCHESTRATION_MAX_THREAD_TURN_LIMIT })).toEqual({
      turnLimit: ORCHESTRATION_MAX_THREAD_TURN_LIMIT,
    });
    expect(decodeHttpQuery({ turnLimit: String(ORCHESTRATION_MAX_THREAD_TURN_LIMIT) })).toEqual({
      turnLimit: ORCHESTRATION_MAX_THREAD_TURN_LIMIT,
    });
  });

  it("rejects oversized explicit windows at both transport boundaries", () => {
    const oversized = ORCHESTRATION_MAX_THREAD_TURN_LIMIT + 1;

    expect(() => decodeSubscribe({ threadId: "thread-1", turnLimit: oversized })).toThrow();
    expect(() => decodeWindow({ turnLimit: oversized })).toThrow();
    expect(() => decodeHttpQuery({ turnLimit: String(oversized) })).toThrow();
  });
});
