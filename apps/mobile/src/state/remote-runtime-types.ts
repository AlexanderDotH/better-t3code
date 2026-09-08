import {
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId, type ServerConfig } from "@t3tools/contracts";

export interface EnvironmentRuntimeState {
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
  readonly serverConfig: ServerConfig | null;
}

export interface ConnectedEnvironmentSummary {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly displayUrl: string;
  readonly isRelayManaged: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
  /** Full runtime truth when projected from the live registry; optional for static fixtures. */
  readonly connection?: EnvironmentConnectionPresentation;
  /** Newest local cache write for this environment, in epoch milliseconds. */
  readonly cacheUpdatedAt?: number | null;
}

export interface SelectedThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}
