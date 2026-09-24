# Project indexing evaluation

The retrieval fixtures use synthetic source only. The normal evaluation runs local extraction, persistence, and query code; it does not configure or call a provider.

## Static retrieval gate

`cases.json` contains eight code-review tasks, each with a failing and corrected source variant. `legacy-query-baseline.json` is a compact capture of the earlier index query on those 16 variants with a 24,000-token request. The capture came from a dirty working checkout while Project Indexing files were untracked; it is a comparison point for this change, not a canonical upstream benchmark. It records actual relevant paths, first three entity paths, and query-estimated tokens. It does not contain source or customer data.

The acceptance test captures actual indexed retrievals and checks that relevant-path recall and top-three coverage do not fall below that baseline, that every response fits the 24,000-token request, and that total query-estimated tokens do not increase. The baseline had full path recall across all 16 variants. Token estimates are not provider billing counts.

```sh
T3CODE_PROJECT_INDEX_EVALUATION_OUTPUT=/tmp/project-index-retrievals.json \
  vp test run apps/server/src/projectIndexing/acceptance/QueryAcceptance.test.ts
node scripts/evaluate-project-indexing.ts \
  --retrievals /tmp/project-index-retrievals.json \
  --baseline scripts/project-indexing-evaluation/legacy-query-baseline.json \
  --output /tmp/project-index-report.json
```

`static-retrieval-cases.json` adds two paired tasks with original `AGENTS.md` rules, including a nested rule. Their acceptance test requires a source hit in the first three entity paths, all applicable rule paths, original source evidence, and a 6,000-token query budget. The corrected variants are negative controls for the same lookup.

```sh
T3CODE_STATIC_RETRIEVAL_OUTPUT=/tmp/project-index-static-captures.json \
  vp test run apps/server/src/projectIndexing/acceptance/StaticRetrievalAcceptance.test.ts
node scripts/project-indexing-evaluation/static-retrieval.ts \
  --captures /tmp/project-index-static-captures.json \
  --output /tmp/project-index-static-report.json
```

The acceptance tests also exercise more than 25,000 inventory files, a class with 97 methods, stale-source rejection, worktree isolation, revision cursors, model-free runtime actions, legacy AI fact filtering, and cancellation while a published revision remains available.

## Explicit AI review evaluation

The optional `evaluate-project-indexing.ts` review scorer accepts saved `ReviewRecord` responses through `--reviews`. It scores grounded issue recall and false positives against fixture paths and source line ranges; it does not judge whether an explanation is useful. The two-file duplication categories accept either file as an anchor only when both were retrieved, and count the relation once.

A live review comparison is available only to a caller that explicitly supplies `allowModelCalls: true` and a `review` callback. The offline command and the acceptance tests never discover or call a provider. The separate prose-compression experiment is not part of static indexing or its release gate.
