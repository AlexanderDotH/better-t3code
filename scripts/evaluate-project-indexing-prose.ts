// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import * as Schema from "effect/Schema";
import { encode as encodeTokens } from "gpt-tokenizer/encoding/o200k_base";

import { EvaluationCorpus, type EvaluationCase } from "./evaluate-project-indexing.ts";

const MINIMUM_TOTAL_TOKEN_REDUCTION = 0.05;
const Rate = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1));
const ProseCase = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  cues: Schema.Array(Schema.Struct({ id: Schema.String, terms: Schema.Array(Schema.String) })),
});
export const ProseCorpus = Schema.Struct({
  version: Schema.Literal(1),
  cases: Schema.Array(ProseCase),
});
export const ProseCompressionRun = Schema.Struct({
  engine: Schema.String,
  softwareVersion: Schema.String,
  model: Schema.String,
  modelRevision: Schema.String,
  packages: Schema.Record(Schema.String, Schema.String),
  captures: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      rate: Rate,
      sourceSha256: Schema.String,
      compressedText: Schema.String,
      durationMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type ProseCompressionRun = typeof ProseCompressionRun.Type;
export const ProseJudgments = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    rate: Rate,
    assessor: Schema.Literals(["human-review", "agent-review", "model-review"]),
    meaningPreserved: Schema.Boolean,
    readable: Schema.Boolean,
    notes: Schema.String,
  }),
);
export type ProseJudgment = (typeof ProseJudgments.Type)[number];

export interface ProseCompressionRequest {
  readonly id: string;
  readonly rate: number;
  readonly text: string;
}
export type ProseEvaluationCase = typeof ProseCase.Type & {
  readonly protectedEvidence: unknown;
};

const decodeSourceCorpus = Schema.decodeSync(Schema.fromJsonString(EvaluationCorpus));
const decodeProseCorpus = Schema.decodeSync(Schema.fromJsonString(ProseCorpus));
const decodeCompressionRun = Schema.decodeSync(Schema.fromJsonString(ProseCompressionRun));
const decodeJudgments = Schema.decodeSync(Schema.fromJsonString(ProseJudgments));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const hash = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");

function protectedSourceEvidence(entry: EvaluationCase) {
  return {
    files: entry.failure.files.map((file) => ({
      id: `synthetic:${file.path}`,
      path: file.path,
      sourceHash: hash(file.content),
      range: { startLine: 1, endLine: file.content.trimEnd().split("\n").length },
      provenance: "synthetic-source",
      confidence: 1,
      source: file.content,
    })),
    rules: [
      {
        id: "synthetic-explicit-rule",
        text: "Use original source and preserve exact identifiers and error contracts.",
        source: "explicit",
      },
    ],
  };
}

export async function readProseEvaluationCases(): Promise<ReadonlyArray<ProseEvaluationCase>> {
  const sourceCorpus = decodeSourceCorpus(
    await NodeFSP.readFile(
      new URL("./project-indexing-evaluation/cases.json", import.meta.url),
      "utf8",
    ),
  );
  const proseCorpus = decodeProseCorpus(
    await NodeFSP.readFile(
      new URL("./project-indexing-evaluation/prose-cases.json", import.meta.url),
      "utf8",
    ),
  );
  return proseCorpus.cases.map((entry) => {
    const source = sourceCorpus.cases.find((candidate) => candidate.id === entry.id);
    if (!source) throw new Error(`No synthetic source case exists for ${entry.id}.`);
    return { ...entry, protectedEvidence: protectedSourceEvidence(source) };
  });
}

function retainedCues(entry: ProseEvaluationCase, text: string) {
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  return entry.cues.map((cue) => ({
    id: cue.id,
    retained: cue.terms.some((term) => words.has(term.toLowerCase())),
  }));
}

/** Only supplemental prose crosses the compressor boundary. Facts, source, and rules stay serialized unchanged. */
export async function evaluateProjectIndexingProse(options: {
  readonly cases: ReadonlyArray<ProseEvaluationCase>;
  readonly rates?: ReadonlyArray<number>;
  readonly captures?: ProseCompressionRun;
  readonly judgments?: ReadonlyArray<ProseJudgment>;
  readonly allowLocalModel?: boolean;
  readonly compress?: (
    requests: ReadonlyArray<ProseCompressionRequest>,
  ) => Promise<ProseCompressionRun>;
}) {
  if (options.compress && options.allowLocalModel !== true)
    throw new Error("Local compression requires allowLocalModel: true.");
  if (options.compress && options.captures)
    throw new Error("Choose captured compression or a local compressor.");
  const rates = options.rates ?? [0.8, 0.5];
  if (
    rates.length === 0 ||
    new Set(rates).size !== rates.length ||
    rates.some((rate) => !Number.isFinite(rate) || rate <= 0 || rate > 1)
  )
    throw new Error("Compression rates must be distinct values above zero and at most one.");
  if (
    options.cases.length === 0 ||
    new Set(options.cases.map((entry) => entry.id)).size !== options.cases.length
  )
    throw new Error("Prose evaluation needs nonempty, uniquely identified cases.");
  const protectedJson = new Map(
    options.cases.map((entry) => {
      const encoded = JSON.stringify(entry.protectedEvidence);
      if (
        encoded === undefined ||
        !NodeUtil.isDeepStrictEqual(decodeJson(encoded), entry.protectedEvidence)
      )
        throw new Error("Protected evidence must roundtrip as exact JSON.");
      return [entry.id, encoded];
    }),
  );
  const requests = options.cases.flatMap((entry) =>
    rates.map((rate) => ({ id: entry.id, rate, text: entry.text })),
  );
  if (requests.length > 64)
    throw new Error("A local prose evaluation accepts at most 64 requests.");
  const run = options.compress ? await options.compress(requests) : options.captures;
  const captures = run?.captures ?? [];
  const expectedKeys = new Set(requests.map((request) => `${request.id}:${request.rate}`));
  const seen = new Set<string>();
  for (const capture of captures) {
    const key = `${capture.id}:${capture.rate}`;
    if (!expectedKeys.has(key) || seen.has(key))
      throw new Error(`Unexpected or duplicate prose capture ${key}.`);
    seen.add(key);
  }
  if (run && seen.size !== expectedKeys.size)
    throw new Error("Compression capture coverage is incomplete.");
  const judgmentKeys = new Set<string>();
  for (const judgment of options.judgments ?? []) {
    const key = `${judgment.id}:${judgment.rate}`;
    if (!run || !expectedKeys.has(key) || judgmentKeys.has(key))
      throw new Error(`Unexpected or duplicate prose judgment ${key}.`);
    judgmentKeys.add(key);
  }
  const rows = requests.map((request) => {
    const entry = options.cases.find((candidate) => candidate.id === request.id)!;
    const fixed = protectedJson.get(entry.id)!;
    if (JSON.stringify(entry.protectedEvidence) !== fixed)
      throw new Error("The compressor changed protected evidence outside its allowed input.");
    const capture = captures.find(
      (candidate) => candidate.id === entry.id && candidate.rate === request.rate,
    );
    if (capture && capture.sourceSha256 !== hash(entry.text))
      throw new Error(`Stale compression capture for ${entry.id}.`);
    const originalPayload = JSON.stringify({
      evidence: decodeJson(fixed),
      supplementalProse: entry.text,
    });
    const compressedPayload = capture
      ? JSON.stringify({ evidence: decodeJson(fixed), supplementalProse: capture.compressedText })
      : null;
    const originalTokens = encodeTokens(originalPayload).length;
    const compressedTokens =
      compressedPayload === null ? null : encodeTokens(compressedPayload).length;
    const cueRetention = capture ? retainedCues(entry, capture.compressedText) : null;
    const judgment =
      options.judgments?.find(
        (candidate) => candidate.id === entry.id && candidate.rate === request.rate,
      ) ?? null;
    return {
      id: entry.id,
      rate: request.rate,
      originalProse: entry.text,
      compressedProse: capture?.compressedText ?? null,
      protectedEvidenceSha256: hash(fixed),
      protectedEvidenceUnchanged: true,
      originalProseTokens: encodeTokens(entry.text).length,
      compressedProseTokens: capture ? encodeTokens(capture.compressedText).length : null,
      originalPayloadTokens: originalTokens,
      compressedPayloadTokens: compressedTokens,
      totalTokenReduction:
        compressedTokens === null ? null : (originalTokens - compressedTokens) / originalTokens,
      cueRetention,
      judgment,
      durationMs: capture?.durationMs ?? null,
    };
  });
  return {
    version: 1,
    tokenizer: "o200k_base",
    compressionStatus: options.compress ? "executed" : options.captures ? "replayed" : "not-run",
    engine: run
      ? {
          engine: run.engine,
          softwareVersion: run.softwareVersion,
          model: run.model,
          modelRevision: run.modelRevision,
          packages: run.packages,
        }
      : null,
    protectedFactsSentToCompressor: false,
    releaseDecision: "do-not-enable-in-runtime",
    rates: rates.map((rate) => {
      const selected = rows.filter((row) => row.rate === rate);
      const originalTokens = selected.reduce((sum, row) => sum + row.originalPayloadTokens, 0);
      const compressedTokens = run
        ? selected.reduce((sum, row) => sum + row.compressedPayloadTokens!, 0)
        : null;
      const lostCues = selected.flatMap((row) =>
        (row.cueRetention ?? []).filter((cue) => !cue.retained).map((cue) => `${row.id}:${cue.id}`),
      );
      const reviewed = selected.filter((row) => row.judgment !== null);
      const failedJudgments = reviewed.filter(
        (row) => !row.judgment!.meaningPreserved || !row.judgment!.readable,
      );
      const reasons = [
        ...(!run ? ["compression-not-run"] : []),
        ...(lostCues.length ? ["lost-prose-concept-cues"] : []),
        ...(compressedTokens !== null &&
        (originalTokens - compressedTokens) / originalTokens < MINIMUM_TOTAL_TOKEN_REDUCTION
          ? ["less-than-five-percent-total-token-reduction"]
          : []),
        ...(reviewed.length !== selected.length ? ["semantic-quality-not-fully-reviewed"] : []),
        ...(failedJudgments.length ? ["prose-quality-regression"] : []),
      ];
      return {
        rate,
        originalPayloadTokens: originalTokens,
        compressedPayloadTokens: compressedTokens,
        totalTokenReduction:
          compressedTokens === null ? null : (originalTokens - compressedTokens) / originalTokens,
        lostCues,
        reviewedCases: reviewed.length,
        failedQualityCases: failedJudgments.map((row) => row.id),
        decision: reasons.length ? "reject" : "further-evaluation-only",
        reasons,
      };
    }),
    limitations: [
      "Concept-cue retention is a lexical diagnostic, not proof of semantic equivalence.",
      "Judgments are separate assessments whose assessor and notes remain visible.",
      "This synthetic prose experiment does not authorize runtime compression.",
    ],
    cases: rows,
  };
}

export function localLLMLinguaCompressor(options: {
  readonly python: string;
  readonly modelDirectory: string;
  readonly cacheDirectory: string;
}) {
  return async (requests: ReadonlyArray<ProseCompressionRequest>) => {
    const repository = await NodeFSP.realpath(
      NodeURL.fileURLToPath(new URL("..", import.meta.url)),
    );
    for (const filename of [options.python, options.modelDirectory, options.cacheDirectory]) {
      if (!NodePath.isAbsolute(filename))
        throw new Error("Local evaluation requires explicit absolute tool and cache paths.");
      const relative = NodePath.relative(repository, await NodeFSP.realpath(filename));
      if (
        relative !== ".." &&
        !relative.startsWith(`..${NodePath.sep}`) &&
        !NodePath.isAbsolute(relative)
      )
        throw new Error("Models, dependencies, and caches must stay outside the source checkout.");
    }
    const script = NodeURL.fileURLToPath(
      new URL("./project-indexing-evaluation/llmlingua-prose.py", import.meta.url),
    );
    const command = NodeUtil.promisify(NodeChildProcess.execFile)(
      options.python,
      [
        script,
        "--allow-local-model",
        "--model-dir",
        options.modelDirectory,
        "--cache-dir",
        options.cacheDirectory,
      ],
      {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, PYTHONNOUSERSITE: "1", TOKENIZERS_PARALLELISM: "false" },
      },
    );
    command.child.stdin?.end(JSON.stringify(requests));
    return decodeCompressionRun((await command).stdout);
  };
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      python: { type: "string" },
      "model-dir": { type: "string" },
      "cache-dir": { type: "string" },
      "allow-local-model": { type: "boolean", default: false },
      captures: { type: "string" },
      judgments: { type: "string" },
      output: { type: "string" },
      "capture-output": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: node scripts/evaluate-project-indexing-prose.ts [--captures local-captures.json] [--judgments judgments.json] [--output report.json]\nTo run a prepared local model, explicitly pass --allow-local-model --python <isolated-python> --model-dir <pinned-model> --cache-dir <temporary-cache> --capture-output <captures.json>. No dependencies or models are downloaded by this command.\n",
    );
    return;
  }
  if (
    values.python &&
    (!values["allow-local-model"] || !values["model-dir"] || !values["cache-dir"])
  )
    throw new Error(
      "A local run requires explicit opt-in, Python, model directory, and cache directory.",
    );
  const captures = values.captures
    ? decodeCompressionRun(await NodeFSP.readFile(values.captures, "utf8"))
    : undefined;
  const judgments = values.judgments
    ? decodeJudgments(await NodeFSP.readFile(values.judgments, "utf8"))
    : undefined;
  let captured: ProseCompressionRun | undefined;
  const compressor = values.python
    ? localLLMLinguaCompressor({
        python: values.python,
        modelDirectory: values["model-dir"]!,
        cacheDirectory: values["cache-dir"]!,
      })
    : undefined;
  const report = await evaluateProjectIndexingProse({
    cases: await readProseEvaluationCases(),
    ...(captures ? { captures } : {}),
    ...(judgments ? { judgments } : {}),
    ...(compressor
      ? {
          allowLocalModel: true,
          compress: async (requests) => {
            captured = await compressor(requests);
            return captured;
          },
        }
      : {}),
  });
  if (captured && values["capture-output"])
    await NodeFSP.writeFile(values["capture-output"], `${JSON.stringify(captured, null, 2)}\n`);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await NodeFSP.writeFile(values.output, output);
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  await main();
