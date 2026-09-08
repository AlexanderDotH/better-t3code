import { createAgentSettingsEnvironmentAtoms } from "@t3tools/client-runtime/state/agent-settings";

import { connectionAtomRuntime } from "../connection/runtime";

export const agentSettingsEnvironment = createAgentSettingsEnvironmentAtoms(connectionAtomRuntime);
