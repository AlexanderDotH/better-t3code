// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  compareContextEncodings,
  evaluateProjectIndexing,
  EvaluationCorpus,
  scoreReview,
  type ReviewResponse,
} from "./evaluate-project-indexing.ts";

const decodeCorpus = Schema.decodeSync(Schema.fromJsonString(EvaluationCorpus));
const readCorpus = async () =>
  decodeCorpus(
    await NodeFSP.readFile(
      new URL("./project-indexing-evaluation/cases.json", import.meta.url),
      "utf8",
    ),
  );

describe("project indexing evaluation", () => {
  it("keeps eight independent failure/corrected pairs and reports unmeasured quality honestly", async () => {
    const corpus = await readCorpus();
    expect(new Set(corpus.cases.map((entry) => entry.category)).size).toBe(8);
    for (const entry of corpus.cases) {
      expect(entry.failure.findings).toHaveLength(1);
      expect(entry.corrected.findings).toHaveLength(0);
      expect(entry.failure.files).not.toEqual(entry.corrected.files);
      for (const variant of [entry.failure, entry.corrected]) {
        expect(
          variant.relevantPaths.every((path) => variant.files.some((file) => file.path === path)),
        ).toBe(true);
      }
    }
    const report = await evaluateProjectIndexing({ corpus });
    expect(report.cases).toHaveLength(16);
    expect(report.contextSource).toBe("source-baseline");
    expect(report.qualityStatus).toBe("not-evaluated");
    expect(report.liveModelCalls).toBe(0);
    expect(report.quality.every((quality) => quality.correctedFalsePositiveRate === null)).toBe(
      true,
    );
    expect(report.cases.every((entry) => entry.encoding.exactRoundtrip)).toBe(true);
  });

  it("roundtrips exact paths, identifiers, punctuation, multiline evidence, and Unicode", () => {
    const evidence = {
      revision: 7,
      sourceHash: "sha256:0123",
      paths: ["src/a,b.ts", "src/with space.ts", "src/naïve.ts", "src/#note.ts"],
      rows: [
        { id: "true", text: "first\nsecond\tthird", range: [1, 19], confidence: null },
        { id: "001", text: 'quoted "name": [x], {y}, |, \\', range: [20, 31], confidence: 0.75 },
      ],
      empty: {},
      flags: [true, false, null],
    };
    const result = compareContextEncodings(evidence);
    expect(result.measurements.compactJsonTokens).toBeGreaterThan(0);
    expect(result.measurements.toonTokens).toBeGreaterThan(0);
    expect(result.measurements.tokenizer).toBe("o200k_base");
    expect(result.measurements.exactRoundtrip).toBe(true);
    expect(() => compareContextEncodings({ evidence, forgotten: undefined })).toThrow("lossy");
  });

  it("requires explicit permission before invoking an injected live reviewer", async () => {
    const review = vi.fn(async (): Promise<ReviewResponse> => ({ findings: [] }));
    await expect(evaluateProjectIndexing({ corpus: await readCorpus(), review })).rejects.toThrow(
      "allowModelCalls: true",
    );
    expect(review).not.toHaveBeenCalled();
  });

  it("counts hallucinated evidence, duplicated findings, and corrected-case false positives", async () => {
    const entry = (await readCorpus()).cases[0]!;
    const finding = {
      category: entry.category,
      path: entry.failure.findings[0]!.path,
      startLine: 1,
      endLine: 2,
      explanation: "The ingestion boundary imports validation from the form module.",
    };
    expect(
      scoreReview(entry.failure, entry.failure.relevantPaths, {
        findings: [finding, finding, { ...finding, path: "src/missing.ts" }],
      }),
    ).toEqual({ truePositives: 1, falsePositives: 2, falseNegatives: 0, ungroundedFindings: 1 });
    expect(
      scoreReview(entry.corrected, entry.corrected.relevantPaths, { findings: [finding] }),
    ).toEqual({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 0,
      ungroundedFindings: 0,
    });
    expect(scoreReview(entry.failure, [], { findings: [finding] })).toEqual({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
      ungroundedFindings: 1,
    });
  });

  it("accepts either explicit member of a duplication relation and counts a double report once", async () => {
    const corpus = await readCorpus();
    const relational = corpus.cases.filter(
      (entry) => entry.failure.findings[0]?.alternativePaths !== undefined,
    );
    expect(relational.map((entry) => entry.id)).toEqual(["copied-helper", "copied-asset-layout"]);
    for (const entry of relational) {
      const expected = entry.failure.findings[0]!;
      const alternate = {
        category: expected.category,
        path: expected.alternativePaths![0]!,
        startLine: 1,
        endLine: 3,
        explanation: `This implementation duplicates the policy in ${expected.path}.`,
      };
      expect(
        scoreReview(entry.failure, entry.failure.relevantPaths, { findings: [alternate] }),
      ).toEqual({
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 0,
        ungroundedFindings: 0,
      });
      expect(
        scoreReview(entry.failure, entry.failure.relevantPaths, {
          findings: [alternate, { ...alternate, path: expected.path }],
        }),
      ).toEqual({ truePositives: 1, falsePositives: 1, falseNegatives: 0, ungroundedFindings: 0 });
      const { alternativePaths: _alternativePaths, ...strictExpected } = expected;
      expect(
        scoreReview({ ...entry.failure, findings: [strictExpected] }, entry.failure.relevantPaths, {
          findings: [alternate],
        }),
      ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1, ungroundedFindings: 0 });
    }
  });

  it("still rejects unrelated anchors, wrong categories, bad ranges, and missing counterpart evidence", async () => {
    const entry = (await readCorpus()).cases.find((candidate) => candidate.id === "copied-helper")!;
    const expected = entry.failure.findings[0]!;
    const alternate = {
      category: expected.category,
      path: expected.alternativePaths![0]!,
      startLine: 1,
      endLine: 3,
      explanation: `This implementation duplicates the policy in ${expected.path}.`,
    };
    const unrelatedPath = "src/unrelated.ts";
    const withUnrelatedSource = {
      ...entry.failure,
      files: [
        ...entry.failure.files,
        { path: unrelatedPath, content: "export const independent = 1;\n" },
      ],
    };
    expect(
      scoreReview(withUnrelatedSource, [...entry.failure.relevantPaths, unrelatedPath], {
        findings: [{ ...alternate, path: unrelatedPath, endLine: 1 }],
      }),
    ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1, ungroundedFindings: 0 });
    expect(
      scoreReview(entry.failure, entry.failure.relevantPaths, {
        findings: [{ ...alternate, category: "pointless-path-conversions" }],
      }),
    ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1, ungroundedFindings: 0 });
    expect(
      scoreReview(entry.failure, entry.failure.relevantPaths, {
        findings: [{ ...alternate, endLine: 99 }],
      }),
    ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1, ungroundedFindings: 1 });
    expect(scoreReview(entry.failure, [alternate.path], { findings: [alternate] })).toEqual({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
      ungroundedFindings: 1,
    });
    expect(
      scoreReview(entry.corrected, entry.corrected.relevantPaths, {
        findings: [{ ...alternate, endLine: 1 }],
      }),
    ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 0, ungroundedFindings: 0 });
  });

  it("does not permit alternative anchors for non-relational expectations or unknown source files", async () => {
    const corpus = await readCorpus();
    const first = corpus.cases[0]!;
    const invalidCategory = {
      ...first,
      failure: {
        ...first.failure,
        findings: [
          { ...first.failure.findings[0]!, alternativePaths: [first.failure.relevantPaths[1]!] },
        ],
      },
    };
    expect(() => decodeCorpus(JSON.stringify({ ...corpus, cases: [invalidCategory] }))).toThrow(
      "explicit duplication relation",
    );
    expect(
      scoreReview(invalidCategory.failure, first.failure.relevantPaths, {
        findings: [
          {
            category: first.category,
            path: first.failure.relevantPaths[1]!,
            startLine: 1,
            endLine: 1,
            explanation: "A non-relational issue must retain its original source anchor.",
          },
        ],
      }),
    ).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1, ungroundedFindings: 0 });
    const relation = corpus.cases.find((entry) => entry.id === "copied-helper")!;
    const unknownSource = {
      ...relation,
      failure: {
        ...relation.failure,
        findings: [{ ...relation.failure.findings[0], alternativePaths: ["src/missing.ts"] }],
      },
    };
    expect(() => decodeCorpus(JSON.stringify({ ...corpus, cases: [unknownSource] }))).toThrow(
      "supplied source files",
    );
  });

  it("reports retrieval misses and incomplete reviews without substituting full source", async () => {
    const entry = (await readCorpus()).cases[0]!;
    const corpus = { version: 1 as const, cases: [entry] };
    const retrievals = [
      {
        caseId: entry.id,
        variant: "failure" as const,
        context: { evidence: [] },
        evidencePaths: [],
      },
      {
        caseId: entry.id,
        variant: "corrected" as const,
        context: { evidence: [] },
        evidencePaths: [],
      },
    ];
    const report = await evaluateProjectIndexing({
      corpus,
      retrievals,
      reviews: [
        {
          caseId: entry.id,
          variant: "corrected",
          format: "compact-json",
          response: { findings: [] },
        },
      ],
    });
    expect(report.contextSource).toBe("index-query-capture");
    expect(report.qualityStatus).toBe("partial");
    expect(report.cases[0]!.retrieval.recall).toBe(0);
    expect(report.cases[0]!.retrieval.missingPaths).toEqual(entry.failure.relevantPaths);
    await expect(
      evaluateProjectIndexing({ corpus, retrievals: retrievals.slice(0, 1) }),
    ).rejects.toThrow("Missing retrieval");
  });
});
