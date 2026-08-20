# Gemini

Gemini runs through Google's official JavaScript SDK. You do not need Gemini CLI: T3 Code is the
harness and owns the session, history, streaming output, tool calls, approvals, and workspace
boundary.

## Set Up Gemini

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open **Settings** and select or add a **Gemini** provider.
3. Add `GOOGLE_API_KEY` to that provider's **Environment variables** and mark it sensitive.
4. Enable the provider and refresh its status.

`GEMINI_API_KEY` also works. When both variables are present, `GOOGLE_API_KEY` wins, matching the
official SDK. Put the key on the environment that runs the T3 server, not on a remote browser or
phone.

## How Tools Work

Gemini receives only tools declared by T3 Code. Repository search and bounded reads use
`workspace_context`; file writes and exact replacements go through T3's path-fenced workspace
service; commands run through T3's bounded process runner. T3 applies the thread's permission mode
before any protected tool executes.

Plan mode and read-only sessions expose only `workspace_context`. A workspace-write sandbox exposes
workspace reads and edits but no shell. Fetch workers are always read-only. Stopping a turn aborts
the local SDK stream and any in-flight T3 tool effect; Google may still account for an API request
that had already reached the service.

Gemini's direct SDK adapter does not currently attach user MCP servers or project-agent
coordination. Those capabilities are shown as unsupported instead of silently falling back to a
different provider. OpenCode's separate `google/...` model route remains available if you need
Gemini through OpenCode and its MCP transport.

## Models And Continuation

Refresh provider status to retrieve the models available to the key. You can also add a custom
model slug in provider settings. T3 stores Gemini conversation history in its own provider-session
state, so stopping and resuming a thread does not depend on a Gemini CLI home directory.
