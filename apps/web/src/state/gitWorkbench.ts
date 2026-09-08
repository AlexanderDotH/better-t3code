import { createGitWorkbenchEnvironmentAtoms } from "@t3tools/client-runtime/git-workbench";

import { connectionAtomRuntime } from "../connection/runtime";

export const gitWorkbenchEnvironment = createGitWorkbenchEnvironmentAtoms(connectionAtomRuntime);
