// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";

import * as Schema from "effect/Schema";

const SourceFile = Schema.Struct({ path: Schema.String, content: Schema.String });
const StaticVariant = Schema.Struct({ files: Schema.Array(SourceFile) });
export const StaticRetrievalCorpus = Schema.Struct({
  version: Schema.Literal(1),
  cases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      task: Schema.String,
      expectedTopPaths: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      requiredSourcePaths: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      requiredRulePaths: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      maxTokens: Schema.Int,
      failure: StaticVariant,
      corrected: StaticVariant,
    }),
  ),
});
export type StaticRetrievalCorpus = typeof StaticRetrievalCorpus.Type;
export const StaticRetrievalCapture = Schema.Struct({
  caseId: Schema.String,
  variant: Schema.Literals(["failure", "corrected"]),
  rankedPaths: Schema.Array(Schema.String),
  evidencePaths: Schema.Array(Schema.String),
  rulePaths: Schema.Array(Schema.String),
  queryTokens: Schema.Int,
});
export type StaticRetrievalCapture = typeof StaticRetrievalCapture.Type;
const decodeCorpus = Schema.decodeSync(Schema.fromJsonString(StaticRetrievalCorpus));
const decodeCaptures = Schema.decodeSync(
  Schema.fromJsonString(Schema.Array(StaticRetrievalCapture)),
);

export function evaluateStaticRetrieval(
  corpus: StaticRetrievalCorpus,
  captures: ReadonlyArray<StaticRetrievalCapture>,
) {
  const expectedKeys = new Set(
    corpus.cases.flatMap((entry) => [`${entry.id}:failure`, `${entry.id}:corrected`]),
  );
  const captureKeys = captures.map((entry) => `${entry.caseId}:${entry.variant}`);
  if (
    captureKeys.length !== expectedKeys.size ||
    new Set(captureKeys).size !== captureKeys.length ||
    captureKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new Error("Static retrieval captures must cover the corpus exactly once.");
  }
  const cases = corpus.cases.flatMap((entry) =>
    (["failure", "corrected"] as const).map((variant) => {
      const capture = captures.find(
        (record) => record.caseId === entry.id && record.variant === variant,
      )!;
      const topThree = capture.rankedPaths.slice(0, 3);
      const missingSources = entry.requiredSourcePaths.filter(
        (path) => !capture.evidencePaths.includes(path),
      );
      const missingRules = entry.requiredRulePaths.filter(
        (path) => !capture.rulePaths.includes(path),
      );
      return {
        caseId: entry.id,
        variant,
        topThree,
        expectedTopPaths: entry.expectedTopPaths,
        missingSources,
        missingRules,
        queryTokens: capture.queryTokens,
        maxTokens: entry.maxTokens,
        passes:
          entry.expectedTopPaths.some((path) => topThree.includes(path)) &&
          missingSources.length === 0 &&
          missingRules.length === 0 &&
          capture.queryTokens <= entry.maxTokens,
      };
    }),
  );
  return {
    version: 1,
    source: "synthetic static source and rule fixtures",
    cases,
    topThreeHits: cases.filter((entry) =>
      entry.expectedTopPaths.some((path) => entry.topThree.includes(path)),
    ).length,
    ruleCoveredCases: cases.filter((entry) => entry.missingRules.length === 0).length,
    totalCases: cases.length,
    passes: cases.every((entry) => entry.passes),
  };
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      corpus: { type: "string" },
      captures: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.captures) {
    process.stdout.write(
      "Usage: node scripts/project-indexing-evaluation/static-retrieval.ts --captures static-query-captures.json [--output report.json]\n",
    );
    return;
  }
  const corpus = decodeCorpus(
    await NodeFSP.readFile(
      values.corpus ?? new URL("./static-retrieval-cases.json", import.meta.url),
      "utf8",
    ),
  );
  const captures = decodeCaptures(await NodeFSP.readFile(values.captures, "utf8"));
  const report = evaluateStaticRetrieval(corpus, captures);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await NodeFSP.writeFile(values.output, output);
  else process.stdout.write(output);
  if (!report.passes) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  await main();
}
