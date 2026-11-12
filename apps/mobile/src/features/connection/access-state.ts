import {
  createAuthAccessCommands,
  createAuthEnvironmentAtoms,
} from "@t3tools/client-runtime/state/auth";

import { connectionAtomRuntime } from "../../connection/runtime";

export const authEnvironment = createAuthEnvironmentAtoms(connectionAtomRuntime);
export const authAccess = createAuthAccessCommands(connectionAtomRuntime);
