/**
 * Hyperagent compatibility driver.
 *
 * Hyperagent does not currently expose an MCP transport that T3 can configure.
 * This driver deliberately uses the OpenCode runtime instead, preserving the
 * Hyperagent provider identity while attaching T3's active MCP servers to the
 * underlying OpenCode session.
 */
import { ProviderDriverKind } from "@t3tools/contracts";

import { makeOpenCodeBackedDriver, type OpenCodeDriverEnv } from "./OpenCodeDriver.ts";

export type HyperagentSimulationDriverEnv = OpenCodeDriverEnv;

export const HyperagentSimulationDriver = makeOpenCodeBackedDriver({
  driverKind: ProviderDriverKind.make("hyperagent"),
  displayName: "Hyperagent (MCP Proxy)",
});
