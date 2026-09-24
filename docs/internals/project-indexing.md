# Project indexing trust and revision boundaries

The index is derived evidence, not an authority for source code or repository instructions. This distinction crosses extraction, persistence, context retrieval, and clients. Indexing never calls a model. Explicit AI review of a user-selected diff is a separate operation.

## Keep facts and uncertainty separate

Syntax extraction records declarations, imports, and callsites even when semantic resolution is unavailable. An import text or name match is not a resolved file or call edge. Compiler evidence can establish a call target; dynamic and ambiguous targets remain unresolved. JavaScript and TypeScript path aliases must be resolved against project configuration. External packages and C# or Java namespaces must retain their own status rather than become invented file dependencies. See the [knowledge contracts](../../packages/contracts/src/projectIndexing/knowledge.ts) and [semantic adapters](../../apps/server/src/projectIndexing/extraction/semantic.ts).

Packages come from manifests. Directory grouping helps navigation but does not imply ownership. Repository rules come from original instruction or configuration files with a path and scope. Nearby code is an example, not a normative rule. The query must preserve provenance, source hash, ranges, and gaps when it packs results into a token budget; a static call path is not proof that the path ran.

## Bind reads to a workspace and revision

An environment resolves the effective project or thread workspace before opening its store. Linked worktrees may share Git metadata, but their source and knowledge stores are independent. A request-supplied filesystem root must never select the store an authenticated session reads.

Readers use published revisions. An in-progress generation must not mix with published facts. Continuations bind to workspace, query, ranking position, and published revision; old cursor formats fail explicitly. A source edit can invalidate evidence before the next revision is published, so query reads recheck relevant hashes. Renames, deletes, manifests, and rules can invalidate relationships beyond the changed symbol. See [query validation](../../apps/server/src/projectIndexing/query/ProjectContextQuery.ts).

Project Indexing stores records in workspace-local RocksDB generations. Starting a generation checkpoints the published generation instead of copying every record, so the previous revision remains readable while writes build the replacement. The earlier `knowledge.sqlite` index is not migrated. Project settings in that index reset to their defaults; users must enable indexing again. After a KV generation publishes, the old SQLite file is removed only when its application ID and workspace ID match this project's owned index.

## Keep context retrieval bounded and read-only

Context queries must not create a store, start indexing, retry a provider, or charge a user. KV search keys index bounded metadata such as paths, symbols, signatures, package names, and rules; they must not duplicate full source bodies. Ranking is deterministic, and related imports, callers, callees, and tests are bounded. Applicable original rules enter independently of text rank. If a rule does not fit, the result names its path and tells the caller to read it.

Automatic agent context is limited to 2,000 tokens per turn. An explicit `project_context` request defaults to 6,000 and accepts up to 24,000 tokens. Source-hash checks, authenticated scope, worktree isolation, pagination, and wire limits still apply. An index response is untrusted prompt data, so agents must read original source and applicable repository instructions before changing code.

`.t3` exclusions apply both before indexing and at artifact export boundaries. Local Git ignores do not remove already tracked files and do not constrain every archive builder. The [artifact verifier](../../scripts/verify-project-indexing-artifacts.ts) checks staged runtime assets and private archive paths. Index RPC telemetry keeps counters and timings without source-bearing spans.
