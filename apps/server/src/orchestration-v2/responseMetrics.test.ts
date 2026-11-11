import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { makeResponseMetricsTracker } from "./responseMetrics.ts";

it.each(["assistant_message", "reasoning"] as const)(
  "publishes first-token latency once for streamed %s and retains it through usage updates",
  (type) => {
    const track = makeResponseMetricsTracker();
    const startedAt = DateTime.makeUnsafe("2026-11-09T12:00:00Z");
    const driver = ProviderDriverKind.make("claudeCode");
    const providerTurn = {
      id: ProviderTurnId.make("turn"),
      providerThreadId: ProviderThreadId.make("provider-thread"),
      nodeId: NodeId.make("root"),
      runAttemptId: RunAttemptId.make("attempt"),
      nativeTurnRef: null,
      ordinal: 1,
      status: "running" as const,
      startedAt,
      completedAt: null,
    };
    track({ type: "provider_turn.updated", driver, providerTurn });
    const item: Extract<ProviderAdapterV2Event, { type: "turn_item.updated" }> = {
      type: "turn_item.updated",
      driver,
      turnItem: {
        id: TurnItemId.make("reply"),
        threadId: ThreadId.make("thread"),
        runId: RunId.make("run"),
        nodeId: providerTurn.nodeId,
        providerThreadId: providerTurn.providerThreadId,
        providerTurnId: providerTurn.id,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "running",
        title: null,
        startedAt,
        completedAt: null,
        updatedAt: DateTime.makeUnsafe("2026-11-09T12:00:00.250Z"),
        type,
        messageId: MessageId.make("message"),
        text: "",
        streaming: true,
      },
    };
    expect(track(item)).toEqual([item]);
    const text = { ...item, turnItem: { ...item.turnItem, text: "First token" } };
    const first = track(text);
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      type: "provider_turn.updated",
      providerTurn: { responseMetrics: { timeToFirstTokenMs: 250 } },
    });
    expect(
      track({
        ...text,
        turnItem: { ...text.turnItem, updatedAt: DateTime.add(startedAt, { seconds: 1 }) },
      }),
    ).toEqual([
      {
        ...text,
        turnItem: { ...text.turnItem, updatedAt: DateTime.add(startedAt, { seconds: 1 }) },
      },
    ]);
    expect(track({ type: "provider_turn.updated", driver, providerTurn })[0]).toMatchObject({
      providerTurn: { responseMetrics: { timeToFirstTokenMs: 250 } },
    });
    expect(
      track({
        type: "provider_turn.updated",
        driver,
        providerTurn: {
          ...providerTurn,
          status: "completed",
          completedAt: DateTime.add(startedAt, { seconds: 2 }),
          responseMetrics: { timeToFirstTokenMs: 200, responseDurationMs: 2000 },
        },
      })[0],
    ).toMatchObject({
      providerTurn: { responseMetrics: { timeToFirstTokenMs: 200, responseDurationMs: 2000 } },
    });
  },
);
