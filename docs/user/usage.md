# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

The token mix keeps provider counters disjoint:

- **New input** is uncached input. Cache-write input is reported separately beneath the main totals.
- **Cached input** was reused from a provider cache.
- **Output** is everything the model returned. **Reasoning** is the reported reasoning portion of
  that output, so it is shown separately but is not added to the processed total a second time.
- **Processed total** is secondary context: new input, cached input, cache writes, and output.

**Calls by role** splits usage that the transcript can prove came from the root agent, subagents,
Auto Reasoning routing, or T3 Code's hidden metadata work, such as thread titles and branch names.
Older or provider-native records without a reliable role signal remain **Unattributed** instead of
being guessed.

When a provider transcript exposes them, **Context diagnostics** shows only counters: native forks,
compact handoffs, total handoff characters, compaction events, the largest reported context window,
instruction characters, memory-injection characters, tool-schema characters, subagent-result
characters, tool-digest characters, and Auto-routing characters. Prompts, handoff text, project
memory, tool results, subagent results, session IDs, and other contents are never included.
Coverage is intentionally partial: tool-digest characters are available from current Codex output
envelopes, while a counter such as historical tool-schema size stays absent when the provider
transcript does not expose it without adding content or instrumentation to the prompt.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Forked Codex transcripts can repeat their parent's earlier token events. The scanner removes that
copied opening burst before aggregation, and shared transcript directories are counted once across
connected environments. This keeps fork and multi-environment totals from counting the same source
twice.

Cache accounting follows provider counters rather than estimating savings. Cache creation, cache
reads, uncached input, and output stay disjoint; reasoning remains a subset of output. This avoids
counting a cache write as both new and cached input, or adding reasoning twice.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.
