import type { ProjectMemoryError, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ProjectMemoryPolicyDecision {
  readonly actor: "root" | "child";
}

export interface ProjectMemoryPolicyShape {
  readonly resolve: (input: {
    readonly threadId: ThreadId;
    readonly ownerThreadId?: ThreadId;
    readonly providerSessionId: string;
    readonly providerInstanceId: ProviderInstanceId;
  }) => Effect.Effect<ProjectMemoryPolicyDecision, ProjectMemoryError>;
}

export class ProjectMemoryPolicy extends Context.Service<
  ProjectMemoryPolicy,
  ProjectMemoryPolicyShape
>()("t3/projectMemory/ProjectMemoryPolicy") {}

export const layer = Layer.succeed(
  ProjectMemoryPolicy,
  ProjectMemoryPolicy.of({
    resolve: (input) =>
      Effect.succeed({
        actor:
          input.ownerThreadId !== undefined && input.ownerThreadId === input.threadId
            ? "root"
            : "child",
      }),
  }),
);
