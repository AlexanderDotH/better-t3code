/**
 * Legacy Hyperagent compatibility driver retained for focused registry tests.
 *
 * Production registration uses `HyperagentDriver`; this OpenCode-backed
 * variant remains available only to callers that explicitly import it.
 */
import { ProviderDriverKind } from "@t3tools/contracts";

import { makeOpenCodeBackedDriver, type OpenCodeDriverEnv } from "./OpenCodeDriver.ts";

export type HyperagentSimulationDriverEnv = OpenCodeDriverEnv;

export const HyperagentSimulationDriver = makeOpenCodeBackedDriver({
  driverKind: ProviderDriverKind.make("hyperagent"),
  displayName: "Hyperagent (MCP Proxy)",
});
