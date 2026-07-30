import { EnvironmentId, SubagentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentSubagentStateAtoms,
  SUBAGENT_STATE_IDLE_TTL_MS,
  type SubagentSnapshotLoader,
} from "./subagents.ts";

describe("createEnvironmentSubagentStateAtoms", () => {
  it("retains a selected transcript briefly and isolates each scoped agent", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | SubagentSnapshotLoader,
      never
    >;
    const subagents = createEnvironmentSubagentStateAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const threadId = ThreadId.make("thread-1");
    const subagentId = SubagentId.make("agent-1");
    const atom = subagents.stateAtom(environmentId, threadId, subagentId);

    expect(atom.idleTTL).toBe(SUBAGENT_STATE_IDLE_TTL_MS);
    expect(subagents.stateAtom(environmentId, threadId, subagentId)).toBe(atom);
    expect(subagents.stateAtom(environmentId, threadId, SubagentId.make("agent-2"))).not.toBe(atom);
    expect(subagents.stateAtom(environmentId, ThreadId.make("thread-2"), subagentId)).not.toBe(
      atom,
    );
  });
});
