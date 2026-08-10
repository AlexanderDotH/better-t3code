import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ModelSelection } from "@t3tools/contracts";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  FETCH_EXPLORATION_ORIENTATION_MAX_CHARS,
  FETCH_EXPLORATION_REQUEST_MAX_CHARS,
  truncateFetchExplorationContext,
} from "../textGeneration/TextGenerationPrompts.ts";
import { discoverWorkspaceContext } from "../workspace/WorkspaceContextEngine.ts";

export const FETCH_EXPLORATION_PLANNER_TIMEOUT = "20 seconds";
const FETCH_EXPLORATION_MATCH_LIMIT = 12;

export interface PlanFetchExplorationInput {
  readonly cwd: string;
  readonly userRequest: string;
  readonly maxRecommendedWorkers: number;
  readonly modelSelection: ModelSelection;
}

export interface FetchExplorationPlanningOutcome {
  readonly plan: TextGeneration.FetchExplorationPlan;
  readonly fallbackReason:
    | "model-unavailable"
    | "entitlement"
    | "planner-failed"
    | "invalid-plan"
    | null;
}

const FALLBACK_PLAN: TextGeneration.FetchExplorationPlan = {
  decision: "run",
  workers: [
    {
      scope: "Broad repository orientation and implementation-path discovery",
      questions: [
        "Which exact files, symbols, conventions, tests, and risks are relevant to the request?",
      ],
    },
  ],
};

const SOURCE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "m",
  "mm",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
]);

const MANIFEST_BASENAMES = new Set([
  "Cargo.toml",
  "Package.swift",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "go.mod",
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "settings.gradle",
  "settings.gradle.kts",
]);

const REQUEST_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "can",
  "could",
  "feature",
  "for",
  "from",
  "have",
  "implement",
  "into",
  "make",
  "model",
  "please",
  "should",
  "that",
  "the",
  "their",
  "this",
  "use",
  "user",
  "with",
]);

function normalizedKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizedWorker(value: unknown): TextGeneration.FetchExplorationWorkerPlan | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.scope !== "string" || !Array.isArray(record.questions)) return null;
  const scope = record.scope.trim();
  if (scope.length < 3 || record.questions.length === 0) return null;
  const questions = record.questions.map((question) =>
    typeof question === "string" ? question.trim() : "",
  );
  if (questions.some((question) => question.length < 3)) return null;
  const questionKeys = questions.map(normalizedKey);
  if (new Set(questionKeys).size !== questionKeys.length) return null;
  return { scope, questions };
}

export function validateFetchExplorationPlan(
  value: unknown,
  maxRecommendedWorkers: number,
): TextGeneration.FetchExplorationPlan | null {
  if (!Number.isSafeInteger(maxRecommendedWorkers) || maxRecommendedWorkers < 1) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.workers)) return null;
  if (record.decision === "skip") {
    return record.workers.length === 0 ? { decision: "skip", workers: [] } : null;
  }
  if (record.decision !== "run") return null;
  if (record.workers.length < 1 || record.workers.length > maxRecommendedWorkers) return null;
  const workers = record.workers.map(normalizedWorker);
  if (workers.some((worker) => worker === null)) return null;
  const normalized = workers as TextGeneration.FetchExplorationWorkerPlan[];
  const scopeKeys = normalized.map((worker) => normalizedKey(worker.scope));
  if (new Set(scopeKeys).size !== scopeKeys.length) return null;
  return { decision: "run", workers: normalized };
}

function requestSearchQuery(userRequest: string): string {
  const tokens = userRequest.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLocaleLowerCase();
    if (REQUEST_STOP_WORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
    if (unique.length === 12) break;
  }
  return unique.join(" ") || "repository";
}

function extension(path: string): string | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const separator = basename.lastIndexOf(".");
  if (separator <= 0 || separator === basename.length - 1) return null;
  return basename.slice(separator + 1).toLocaleLowerCase();
}

function isManifest(path: string): boolean {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  return (
    MANIFEST_BASENAMES.has(basename) || basename.endsWith(".csproj") || basename.endsWith(".sln")
  );
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(spec|test)\.[^/]+$/i.test(path);
}

function countBy(values: ReadonlyArray<string>): ReadonlyArray<readonly [string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].toSorted(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
  );
}

function compactExcerpt(value: string | undefined): string | null {
  const compact = value?.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.length <= 240 ? compact : `${compact.slice(0, 227)}... [truncated]`;
}

function formatPathList(paths: ReadonlyArray<string>, limit: number): string {
  if (paths.length === 0) return "(none found)";
  const retained = paths.slice(0, limit);
  const suffix =
    paths.length > retained.length ? `; ... ${paths.length - retained.length} more` : "";
  return `${retained.join("; ")}${suffix}`;
}

export const buildFetchRepositoryOrientation = Effect.fn(
  "FetchExplorationPlanner.buildRepositoryOrientation",
)(function* (input: { readonly cwd: string; readonly userRequest: string }) {
  const query = requestSearchQuery(input.userRequest);
  const discovery = yield* Effect.tryPromise(() =>
    discoverWorkspaceContext({
      workspaceRoot: input.cwd,
      queries: [{ text: query, mode: "auto", maxResults: FETCH_EXPLORATION_MATCH_LIMIT }],
      includeInventoryFilePaths: true,
    }),
  ).pipe(Effect.option);
  if (Option.isNone(discovery)) {
    return "Repository orientation unavailable; the worker must establish bounded orientation itself.";
  }

  const value = discovery.value;
  const paths = value.inventoryFilePaths ?? [];
  const topLevelAreas = countBy(
    paths.map((path) => (path.includes("/") ? (path.split("/", 1)[0] ?? "(root)") : "(root)")),
  );
  const sourceExtensions = countBy(
    paths.flatMap((path) => {
      const value = extension(path);
      return value && SOURCE_EXTENSIONS.has(value) ? [`.${value}`] : [];
    }),
  );
  const sourceFileCount = sourceExtensions.reduce((count, [, value]) => count + value, 0);
  const manifests = paths.filter(isManifest).toSorted();
  const tests = paths.filter(isTestPath).toSorted();
  const relevantMatches = value.queries.flatMap((result) => result.matches);
  const relevantLines = relevantMatches.map((match) => {
    const location = match.matchLine ? `${match.path}:${match.matchLine}` : match.path;
    const excerpt = compactExcerpt(match.excerpt);
    return excerpt ? `${location} — ${excerpt}` : location;
  });
  const lines = [
    `Discovery backend: ${value.backend}`,
    `Workspace breadth: ${paths.length} files (${value.inventoryCount} files and parent areas indexed)${value.truncated ? "; bounded discovery was truncated" : ""}.`,
    `Meaningful source breadth: ${sourceFileCount} source files; ${
      sourceExtensions
        .slice(0, 16)
        .map(([name, count]) => `${name}=${count}`)
        .join(", ") || "no recognized source extensions"
    }.`,
    `Top-level areas: ${
      topLevelAreas
        .slice(0, 20)
        .map(([name, count]) => `${name} (${count})`)
        .join(", ") || "(none found)"
    }.`,
    `Manifests: ${formatPathList(manifests, 24)}.`,
    `Test locations: ${formatPathList(tests, 32)}.`,
    `Relevant request matches for "${query.replaceAll('"', "'")}": ${formatPathList(relevantLines, FETCH_EXPLORATION_MATCH_LIMIT)}.`,
    ...(value.warnings.length > 0 ? [`Discovery warnings: ${value.warnings.join(" ")}`] : []),
  ];
  return truncateFetchExplorationContext(lines.join("\n"), FETCH_EXPLORATION_ORIENTATION_MAX_CHARS);
});

type PlannerAttempt =
  | { readonly status: "success"; readonly plan: TextGeneration.FetchExplorationPlan }
  | {
      readonly status: "failure";
      readonly modelReason: "model-unavailable" | "entitlement" | null;
    };

function fetchModelFailureReason(error: unknown): "model-unavailable" | "entitlement" | null {
  if (typeof error !== "object" || error === null || !Object.hasOwn(error, "reason")) return null;
  const reason = (error as { readonly reason?: unknown }).reason;
  return reason === "model-unavailable" || reason === "entitlement" ? reason : null;
}

export const requestFetchExplorationPlan = Effect.fn("FetchExplorationPlanner.requestPlan")(
  function* (
    input: TextGeneration.FetchExplorationGenerationInput,
  ): Effect.fn.Return<FetchExplorationPlanningOutcome, never, TextGeneration.TextGeneration> {
    const textGeneration = yield* TextGeneration.TextGeneration;
    const attempted = yield* textGeneration.planFetchExploration(input).pipe(
      Effect.map(
        (plan): PlannerAttempt => ({
          status: "success",
          plan,
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed<PlannerAttempt>({
          status: "failure",
          modelReason: fetchModelFailureReason(error),
        }),
      ),
      Effect.timeoutOption(FETCH_EXPLORATION_PLANNER_TIMEOUT),
    );
    if (Option.isNone(attempted)) {
      return { plan: FALLBACK_PLAN, fallbackReason: "planner-failed" };
    }
    if (attempted.value.status === "failure") {
      return {
        plan: FALLBACK_PLAN,
        fallbackReason: attempted.value.modelReason ?? "planner-failed",
      };
    }
    const plan = validateFetchExplorationPlan(attempted.value.plan, input.maxRecommendedWorkers);
    if (!plan) return { plan: FALLBACK_PLAN, fallbackReason: "invalid-plan" };
    return { plan, fallbackReason: null };
  },
);

export const planFetchExploration = Effect.fn("FetchExplorationPlanner.plan")(function* (
  input: PlanFetchExplorationInput,
): Effect.fn.Return<FetchExplorationPlanningOutcome, never, TextGeneration.TextGeneration> {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const planned = yield* Effect.gen(function* () {
    const userRequest = truncateFetchExplorationContext(
      input.userRequest,
      FETCH_EXPLORATION_REQUEST_MAX_CHARS,
    );
    const repositoryOrientation = yield* buildFetchRepositoryOrientation({
      cwd: input.cwd,
      userRequest,
    });
    return yield* requestFetchExplorationPlan({
      cwd: input.cwd,
      userRequest,
      repositoryOrientation,
      maxRecommendedWorkers: input.maxRecommendedWorkers,
      modelSelection: input.modelSelection,
    }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));
  }).pipe(Effect.timeoutOption(FETCH_EXPLORATION_PLANNER_TIMEOUT));
  return Option.getOrElse(planned, () => ({
    plan: FALLBACK_PLAN,
    fallbackReason: "planner-failed" as const,
  }));
});
