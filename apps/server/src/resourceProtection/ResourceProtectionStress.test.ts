import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import {
  makeBoundedProviderEventQueue,
  providerEventEncodedBytes,
  PROVIDER_SESSION_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_SESSION_EVENT_QUEUE_CAPACITY,
} from "../provider/boundedEventQueue.ts";
import {
  GIBIBYTE,
  makeSubagentResourceGovernor,
  resourceConfigurationKey,
  type ResourceGovernorProcessSample,
} from "./SubagentResourceGovernor.ts";

const AGENT_COUNT = 5;
const MCP_SERVER_COUNT = 10;
const DELTA_COUNT = 12_574;
const COMPLETION_BYTES = 1024 * 1024;
const codex = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex-main");

type StressEvent =
  | {
      readonly type: "content.delta";
      readonly sequence: number;
      readonly delta: string;
    }
  | {
      readonly type: "turn.completed";
      readonly model: string;
      readonly tools: ReadonlyArray<string>;
      readonly mcpServers: ReadonlyArray<string>;
      readonly result: string;
    };

describe("resource protection reproduction", () => {
  it.effect(
    "completes five gated Codex agents with bounded 12,574-delta streams and 1 MiB results",
    () =>
      Effect.gen(function* () {
        const governor = yield* makeSubagentResourceGovernor();
        const threadIds = Array.from({ length: AGENT_COUNT }, (_, index) =>
          ThreadId.make(`stress-codex-${index + 1}`),
        );
        const mcpServers = Array.from(
          { length: MCP_SERVER_COUNT },
          (_, index) => `mock-mcp-${index + 1}`,
        );
        const model = "gpt-5.6-sol";
        const tools = ["spawn_agent", "mcp"] as const;
        const configurationKey = resourceConfigurationKey({ model, tools, mcpServers });
        const processes: ReadonlyArray<ResourceGovernorProcessSample> = threadIds.map(
          (_threadId, index) => ({
            pid: 10_000 + index,
            ppid: 1,
            startTimeMs: 100_000 + index * 1_000,
            residentBytes: 128 * 1024 * 1024,
          }),
        );
        const sample = (sampledAtMs: number) => ({
          sampledAtMs,
          memory: {
            totalBytes: 64 * GIBIBYTE,
            availableBytes: 40 * GIBIBYTE,
            swapTotalBytes: 16 * GIBIBYTE,
            swapFreeBytes: 16 * GIBIBYTE,
          },
          processes,
        });

        const monitoringDemand = yield* governor.monitoringDemand.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        yield* Effect.forEach(
          threadIds,
          (threadId, index) =>
            governor.registerProviderProcess({
              threadId,
              provider: codex,
              providerInstanceId: codexInstance,
              pid: 10_000 + index,
              startTimeMs: 100_000 + index * 1_000,
            }),
          { discard: true },
        );
        yield* governor.observe(sample(0));

        const admissions = yield* Effect.forEach(threadIds, (threadId) =>
          governor
            .awaitAdmission({
              threadId,
              provider: codex,
              providerInstanceId: codexInstance,
              configurationKey,
            })
            .pipe(Effect.forkChild),
        );
        yield* Effect.yieldNow;
        expect(admissions[0]?.pollUnsafe()).toBeDefined();
        expect(admissions.slice(1).every((fiber) => fiber.pollUnsafe() === undefined)).toBe(true);

        for (let index = 1; index <= 5; index += 1) {
          yield* governor.observe(sample(index * 1_000));
        }
        expect(yield* Effect.forEach(admissions, Fiber.join)).toEqual([
          true,
          true,
          true,
          true,
          true,
        ]);

        const queues = yield* Effect.forEach(threadIds, () =>
          makeBoundedProviderEventQueue<StressEvent>({
            capacity: PROVIDER_SESSION_EVENT_QUEUE_CAPACITY,
            byteCapacity: PROVIDER_SESSION_EVENT_QUEUE_BYTE_CAPACITY,
            sizeOf: providerEventEncodedBytes,
          }),
        );
        const completionResult = "R".repeat(COMPLETION_BYTES);
        const producers = yield* Effect.forEach(queues, (queue) =>
          Effect.gen(function* () {
            for (let sequence = 0; sequence < DELTA_COUNT; sequence += 1) {
              yield* queue.offer({ type: "content.delta", sequence, delta: "x" });
            }
            yield* queue.offer({
              type: "turn.completed",
              model,
              tools,
              mcpServers,
              result: completionResult,
            });
          }).pipe(Effect.forkChild),
        );
        yield* Effect.yieldNow;
        expect(producers.every((fiber) => fiber.pollUnsafe() === undefined)).toBe(true);

        // The authority remains immediately readable while all five producers
        // are under queue pressure; no client-side decision is involved.
        const duringPressure = yield* governor.latest;
        expect(duringPressure.availableMemoryBytes).toBeGreaterThan(
          duringPressure.coreReserveBytes,
        );
        expect(duringPressure.waitingStarts).toBe(0);

        const consumers = yield* Effect.forEach(queues, (queue) =>
          Effect.gen(function* () {
            for (let sequence = 0; sequence < DELTA_COUNT; sequence += 1) {
              const event = yield* queue.take;
              if (event.type !== "content.delta" || event.sequence !== sequence) {
                throw new Error(`Provider event order changed at sequence ${sequence}`);
              }
            }
            const completion = yield* queue.take;
            if (completion.type !== "turn.completed") {
              throw new Error("Missing complete provider result");
            }
            return completion;
          }).pipe(Effect.forkChild),
        );

        yield* Effect.forEach(producers, Fiber.join, { discard: true, concurrency: "unbounded" });
        const completions = yield* Effect.forEach(consumers, Fiber.join, {
          concurrency: "unbounded",
        });
        for (const completion of completions) {
          expect(completion.model).toBe(model);
          expect(completion.tools).toEqual(tools);
          expect(completion.mcpServers).toEqual(mcpServers);
          expect(completion.result.length).toBe(COMPLETION_BYTES);
          expect(completion.result).toBe(completionResult);
        }

        for (let index = 6; index <= 10; index += 1) {
          yield* governor.observe(sample(index * 1_000));
        }
        expect((yield* governor.latest).reservedMemoryBytes).toBe(0);

        yield* Effect.forEach(
          threadIds,
          (_threadId, index) =>
            governor.unregisterProviderProcess({
              pid: 10_000 + index,
              startTimeMs: 100_000 + index * 1_000,
            }),
          { discard: true },
        );
        expect(Array.from(yield* Fiber.join(monitoringDemand))).toEqual([false, true, false]);
        yield* Effect.forEach(queues, (queue) => queue.shutdown, { discard: true });
        yield* governor.shutdown;
      }),
    30_000,
  );
});
