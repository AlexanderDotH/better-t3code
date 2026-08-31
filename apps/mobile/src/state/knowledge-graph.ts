import { createKnowledgeGraphEnvironmentAtoms } from "@t3tools/client-runtime/state/knowledge-graph";

import { connectionAtomRuntime } from "../connection/runtime";

export const knowledgeGraphEnvironment =
  createKnowledgeGraphEnvironmentAtoms(connectionAtomRuntime);
