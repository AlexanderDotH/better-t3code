import type { OrchestrationSubagentDetail } from "@t3tools/contracts";
import * as Option from "effect/Option";

export type EnvironmentSubagentStatus = "empty" | "cached" | "synchronizing" | "live" | "deleted";

export interface EnvironmentSubagentState {
  readonly data: Option.Option<OrchestrationSubagentDetail>;
  readonly status: EnvironmentSubagentStatus;
  readonly error: Option.Option<string>;
}

export const EMPTY_ENVIRONMENT_SUBAGENT_STATE: EnvironmentSubagentState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
};
