# Usage accounting

Usage reporting scans provider-owned transcripts and aggregates content-free counters. Raw records,
prompts, memory, handoff contents, session IDs, and provider cursors never cross the usage contract.

## Token math and attribution

`uncachedInputTokens`, `cachedInputTokens`, and `cacheCreationTokens` are disjoint. Processed total is
their sum plus `outputTokens`. `reasoningTokens` is a reported subset of output and is never added
again. A bucket carries best-effort `callKind`: `root`, `subagent`, `metadata`, `auto-reasoning`, or
`unknown`. Missing attribution from older servers maps to `unknown`.

Codex session metadata proves root versus subagent sessions, and the T3 metadata prompt marker proves
hidden text-generation work. Claude's explicit `isSidechain` signal proves subagent calls; the same
T3 marker proves metadata work. Providers without a reliable signal remain unknown. Aggregation
includes call kind in the bucket key so categories cannot collapse into one another.
The existing `<t3code_auto_reasoning_call>` marker proves an Auto routing call without retaining its
prompt. After its usage record, attribution returns to the session's root or subagent category.

## Deduplication and diagnostics

Claude repeats one message's complete usage on each content block, so records deduplicate by message
and request IDs. A Codex native fork begins with a re-stamped copy of its parent's token history; the
scanner drops that leading synchronous burst and counts only the child's first genuine turn onward.
Cross-environment source fingerprints are claimed before totals, call splits, or diagnostics are
merged, so shared transcript directories cannot double count any of them.

Optional `UsageContextDiagnostics` contains only nonnegative aggregate counters: native forks,
compact handoffs, total handoff characters, compaction events, maximum reported context tokens,
instruction characters, memory-injection characters, tool-schema characters, subagent-result
characters, tool-digest characters, and Auto-routing characters. Counters attach at the same record
and source-deduplication boundary as token usage. Signals that are not observable stay absent rather
than being inferred. Codex model-facing tool digests are measured from their existing output
envelopes. Tool-schema sizes remain absent from historical usage until a provider transcript exposes
them; the scanner never adds prompt markers just to measure them.

The scan cache version changes when record reconstruction changes. Current cached rows retain call
kind and diagnostics; malformed or older rows trigger a cold re-scan instead of silently dropping
fields.
