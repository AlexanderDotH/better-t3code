import {
  KnowledgeGraphOperationError,
  KnowledgeGraphQueryBatchInput,
  KnowledgeGraphQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as KnowledgeGraphRuntime from "../../../knowledge-graph/runtime/KnowledgeGraphRuntime.ts";

const queryParseOptions = { onExcessProperty: "error" } as const;
const decodeQueryParameters = SchemaParser.decodeUnknownEffect(
  KnowledgeGraphQueryBatchInput,
  queryParseOptions,
);

// Toolkit supplies no parse options, so the codec must enforce the same
// strict boundary advertised by its JSON schema before invoking the handler.
const KnowledgeGraphQueryParameters = Schema.declareConstructor<
  KnowledgeGraphQueryBatchInput,
  typeof KnowledgeGraphQueryBatchInput.Encoded
>()(
  [KnowledgeGraphQueryBatchInput],
  () => (input, _ast, options) =>
    decodeQueryParameters(input, { ...options, ...queryParseOptions }),
  {
    toCodecJson: () =>
      Schema.link<KnowledgeGraphQueryBatchInput>()(
        Schema.Json.check(
          Schema.makeFilter(Schema.is(KnowledgeGraphQueryBatchInput), {
            toJsonSchema: () =>
              Schema.toJsonSchemaDocument(KnowledgeGraphQueryBatchInput, queryParseOptions).schema,
          }),
        ),
        SchemaTransformation.transform<KnowledgeGraphQueryBatchInput, Schema.Json>({
          decode: Schema.decodeUnknownSync(KnowledgeGraphQueryBatchInput, queryParseOptions),
          encode: (input) => input,
        }),
      ),
  },
);

export const KnowledgeGraphQueryTool = Tool.make("knowledge_graph_query", {
  description:
    "Query the rebuildable project Knowledge Graph for the authenticated thread's canonical project or worktree. The server selects the scope; callers cannot provide a workspace root or mutate graph data.",
  parameters: KnowledgeGraphQueryParameters,
  success: KnowledgeGraphQueryResultV1,
  failure: Schema.Union([KnowledgeGraphOperationError, WorkspaceContextUnavailableError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    KnowledgeGraphRuntime.KnowledgeGraphRuntime,
  ],
})
  .annotate(Tool.Title, "Query project Knowledge Graph")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const KnowledgeGraphToolkit = Toolkit.make(KnowledgeGraphQueryTool);
