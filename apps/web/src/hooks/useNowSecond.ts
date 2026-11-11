import { secondTick } from "@t3tools/client-runtime/clock";
import { useSyncExternalStore } from "react";

const subscribeNever = () => () => undefined;

export function useNowSecond(enabled = true): number {
  return useSyncExternalStore(
    enabled ? secondTick.subscribe : subscribeNever,
    secondTick.getSnapshot,
    secondTick.getSnapshot,
  );
}
