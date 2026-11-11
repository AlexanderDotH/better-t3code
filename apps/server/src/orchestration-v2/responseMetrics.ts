import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";
import type { OrchestrationV2ProviderTurn, ProviderTurnId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function makeResponseMetricsTracker() {
  const turns = new Map<ProviderTurnId, OrchestrationV2ProviderTurn>();
  return (event: ProviderAdapterV2Event): ReadonlyArray<ProviderAdapterV2Event> => {
    if (event.type === "provider_turn.updated") {
      const previous = turns.get(event.providerTurn.id);
      const turn =
        previous?.responseMetrics === undefined
          ? event.providerTurn
          : {
              ...event.providerTurn,
              responseMetrics: {
                ...previous.responseMetrics,
                ...event.providerTurn.responseMetrics,
              },
            };
      turns.set(turn.id, turn);
      return turn === event.providerTurn ? [event] : [{ ...event, providerTurn: turn }];
    }
    if (event.type !== "turn_item.updated") return [event];
    const item = event.turnItem;
    if (
      item.providerTurnId === null ||
      (item.type !== "assistant_message" && item.type !== "reasoning") ||
      item.text.length === 0
    )
      return [event];
    const turn = turns.get(item.providerTurnId);
    if (
      turn?.startedAt == null ||
      turn.status !== "running" ||
      turn.responseMetrics?.timeToFirstTokenMs !== undefined
    )
      return [event];
    const updated = {
      ...turn,
      responseMetrics: {
        ...turn.responseMetrics,
        timeToFirstTokenMs: Math.max(
          0,
          DateTime.toEpochMillis(item.updatedAt) - DateTime.toEpochMillis(turn.startedAt),
        ),
      },
    };
    turns.set(turn.id, updated);
    const { tokenUsage: _tokenUsage, ...metricsUpdate } = updated;
    return [
      {
        type: "provider_turn.updated",
        driver: event.driver,
        threadId: item.threadId,
        providerTurn: metricsUpdate,
      },
      event,
    ];
  };
}
