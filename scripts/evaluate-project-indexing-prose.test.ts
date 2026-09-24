// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { expect, it, vi } from "vite-plus/test";

import {
  evaluateProjectIndexingProse,
  readProseEvaluationCases,
  type ProseCompressionRequest,
  type ProseCompressionRun,
} from "./evaluate-project-indexing-prose.ts";

const fixture = {
  id: "synthetic-prose",
  text: "A shared normalization explanation makes duplicated responsibilities easier to understand.",
  cues: [
    { id: "shared", terms: ["shared"] },
    { id: "duplication", terms: ["duplicated", "duplication"] },
  ],
  protectedEvidence: {
    sourceHash: "EXACT_SOURCE_HASH",
    source: "export function exactIdentifier() { throw new ExactError(); }",
    path: "src/exact.ts",
    range: [1, 7],
    confidence: 0.75,
    provenance: "compiler",
    rules: ["EXACT_RULE_SENTINEL: never alter the error contract."],
  },
};
const syntheticRun = (
  requests: ReadonlyArray<ProseCompressionRequest>,
  text: string,
): ProseCompressionRun => ({
  engine: "synthetic-test-compressor",
  softwareVersion: "test",
  model: "none",
  modelRevision: "none",
  packages: {},
  captures: requests.map((request) => ({
    id: request.id,
    rate: request.rate,
    sourceSha256: NodeCrypto.createHash("sha256").update(request.text).digest("hex"),
    compressedText: text,
    durationMs: 1,
  })),
});

it("never runs an implicit compressor and reports unmeasured quality honestly", async () => {
  const compress = vi.fn(async (requests: ReadonlyArray<ProseCompressionRequest>) =>
    syntheticRun(requests, "shared duplication"),
  );
  await expect(evaluateProjectIndexingProse({ cases: [fixture], compress })).rejects.toThrow(
    "allowLocalModel: true",
  );
  expect(compress).not.toHaveBeenCalled();
  const report = await evaluateProjectIndexingProse({ cases: await readProseEvaluationCases() });
  expect(report.compressionStatus).toBe("not-run");
  expect(report.releaseDecision).toBe("do-not-enable-in-runtime");
  expect(
    report.cases.every((entry) => entry.compressedProse === null && entry.judgment === null),
  ).toBe(true);
});

it("sends only prose to the compressor and retains exact facts and rules unchanged", async () => {
  let requestJson = "";
  const original = JSON.stringify(fixture.protectedEvidence);
  const report = await evaluateProjectIndexingProse({
    cases: [fixture],
    rates: [0.5],
    allowLocalModel: true,
    compress: async (requests) => {
      requestJson = JSON.stringify(requests);
      return syntheticRun(requests, "shared normalization duplicated responsibilities");
    },
  });
  expect(requestJson).toContain(fixture.text);
  for (const value of [
    "EXACT_SOURCE_HASH",
    "EXACT_RULE_SENTINEL",
    "exactIdentifier",
    "src/exact.ts",
    "confidence",
    "provenance",
  ])
    expect(requestJson).not.toContain(value);
  expect(JSON.stringify(fixture.protectedEvidence)).toBe(original);
  expect(report.cases[0]?.protectedEvidenceSha256).toBe(
    NodeCrypto.createHash("sha256").update(original).digest("hex"),
  );
  expect(report.protectedFactsSentToCompressor).toBe(false);
  expect(report.cases[0]?.protectedEvidenceUnchanged).toBe(true);
  expect(report.cases[0]?.originalPayloadTokens).toBeGreaterThan(
    report.cases[0]!.originalProseTokens,
  );
});

it("rejects lost concepts and poor explanation quality even when token compression improves", async () => {
  const requests = [{ id: fixture.id, rate: 0.5, text: fixture.text }];
  const report = await evaluateProjectIndexingProse({
    cases: [fixture],
    rates: [0.5],
    captures: syntheticRun(requests, "normalization"),
    judgments: [
      {
        id: fixture.id,
        rate: 0.5,
        assessor: "agent-review",
        meaningPreserved: false,
        readable: false,
        notes: "Only a topic noun remains; the shared duplication relation disappeared.",
      },
    ],
  });
  expect(report.rates[0]?.decision).toBe("reject");
  expect(report.rates[0]?.lostCues).toEqual([
    "synthetic-prose:shared",
    "synthetic-prose:duplication",
  ]);
  expect(report.rates[0]?.failedQualityCases).toEqual([fixture.id]);
  expect(report.rates[0]?.reasons).toContain("prose-quality-regression");
});

it("rejects stale or incomplete captures and refuses changes to protected evidence", async () => {
  const requests = [{ id: fixture.id, rate: 0.5, text: fixture.text }];
  const stale = syntheticRun(requests, "shared duplication");
  await expect(
    evaluateProjectIndexingProse({
      cases: [{ ...fixture, text: "Changed source prose" }],
      rates: [0.5],
      captures: stale,
    }),
  ).rejects.toThrow("Stale compression");
  await expect(
    evaluateProjectIndexingProse({ cases: [fixture], rates: [0.5, 0.8], captures: stale }),
  ).rejects.toThrow("coverage is incomplete");
  const mutable = { ...fixture, protectedEvidence: { rule: "keep exact" } };
  await expect(
    evaluateProjectIndexingProse({
      cases: [mutable],
      rates: [0.5],
      allowLocalModel: true,
      compress: async (input) => {
        mutable.protectedEvidence.rule = "changed";
        return syntheticRun(input, "shared duplication");
      },
    }),
  ).rejects.toThrow("changed protected evidence");
});
