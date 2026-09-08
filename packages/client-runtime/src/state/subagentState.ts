import type { OrchestrationSubagentDetail } from "@t3tools/contracts";
import * as Option from "effect/Option";

export type EnvironmentSubagentStatus = "empty" | "cached" | "synchronizing" | "live" | "deleted";

export interface EnvironmentSubagentPageState {
  readonly beforeCursor: string | null;
  readonly hasMore: boolean;
  readonly loadingOlder: boolean;
}

export interface EnvironmentSubagentState {
  readonly data: Option.Option<OrchestrationSubagentDetail>;
  readonly status: EnvironmentSubagentStatus;
  readonly error: Option.Option<string>;
  readonly page: Option.Option<EnvironmentSubagentPageState>;
}

export const EMPTY_ENVIRONMENT_SUBAGENT_STATE: EnvironmentSubagentState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
  page: Option.none(),
};

export function subagentHasOlderActivities(state: EnvironmentSubagentState): boolean {
  return Option.match(state.page, {
    onNone: () => false,
    onSome: (page) => page.hasMore,
  });
}
