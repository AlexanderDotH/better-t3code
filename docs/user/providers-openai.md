# OpenAI Responses (Early Access)

OpenAI Responses lets T3 Code use an OpenAI API key with a compatible model from the account's
live model catalog. T3 remains the coding-agent harness: it owns the transcript, approvals,
workspace tools, configured MCP servers, checkpoints, subagents, Fetch workers, and interruption.

This provider is **Early Access**. It uses the official OpenAI Responses API directly. It does not
use a ChatGPT subscription, Codex login, OpenRouter account, hosted shell, or provider-side MCP
execution.

- [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)

## Connect an API key

1. Open **Settings > Providers** on the environment that will run the agent.
2. Under **Additional Better T3 providers**, add **OpenAI Responses**.
3. Paste an OpenAI API key into the credential field and save it.
4. Wait for the provider card to show the masked key label and a non-empty compatible model list.
5. Select an OpenAI Responses model in the chat model picker.

T3 validates a submitted key against the live model catalog before replacing the stored key. A
rejected or unreachable replacement leaves the previous stored credential intact. The server never
returns the key to a client.

As an alternative, add `OPENAI_API_KEY` as a sensitive environment variable on that provider
instance. A stored key takes precedence over the environment value. Environment-backed credentials
cannot be removed from T3; remove the variable from the provider instance instead.

Each provider instance has isolated credentials and settings. This allows separate personal and
work OpenAI accounts without sharing keys between instances.

## Models and reasoning

T3 intersects the account's live `/models` response with models whose coding-agent capabilities
have been tested in this release. A model that is unavailable to the account or lacks tested T3
capability does not appear as selectable. T3 does not silently switch models after a request fails.

The model picker exposes only reasoning-effort values tested for the selected model. Changing the
model or reasoning effort applies to the next turn while the T3-owned session and transcript remain
intact.

## Privacy and continuation

Every response request uses `store: false`. T3 persists the response items required to continue the
conversation locally, including encrypted reasoning material returned for stateless continuation.
It replays those items with the visible transcript instead of depending on a stored OpenAI response
or `previous_response_id`.

The encrypted material is opaque to T3 and is not rendered as hidden reasoning. A model-provided
reasoning summary may appear in the normal reasoning UI when available.

## Tools, approvals, and MCP

OpenAI receives the tools exposed by T3 for the current thread and mode. T3 executes every tool and
projects the result into the transcript. This keeps workspace access, command execution, file
changes, checkpoints, subagents, Knowledge Graph queries, and configured MCP servers behind the
same authorization and approval rules as other T3 providers.

Repository search and bounded reads use `workspace_context`. Writable turns receive one
`workspace_edit` tool that can combine ordinary UTF-8 writes, exact replacements, range edits, and
deletions across files. Commands remain the fallback for formatters, generators, binaries,
oversized files, permissions, and directory operations.

Parallel tool calls are bounded and run through T3. Plan mode and Fetch workers remain read-only.
Fetch workers receive only T3's built-in read-only workspace context, not configured MCP servers or
coordination tools.
OpenAI-hosted shell, computer, file-search, web-search, and remote MCP tools are not enabled by this
provider.

Image attachments are sent as native image input. Other attachment types remain accessible through
their T3-managed workspace path when the selected runtime mode permits access; they are not uploaded
as native OpenAI file inputs in this release.

## Disconnect or replace a key

Submitting a replacement key validates it before T3 stops the selected instance's active sessions
and stores the new credential. Select **Disconnect** to remove a stored key. Disconnecting stops
only sessions owned by that provider instance and does not affect Codex, ChatGPT Subscription,
OpenRouter, or another OpenAI Responses instance.

## Troubleshooting

- **No compatible models:** confirm that the key can access a model supported by this T3 release,
  then refresh provider status. Live but untested models stay hidden.
- **Invalid key:** create or copy an OpenAI API key for the intended project, then submit it again.
- **Rate limited:** wait for the retry time reported by the provider. T3 does not repeat a paid
  request or switch accounts automatically.
- **Model unavailable:** choose another model from the refreshed live catalog. A removed model is
  blocked before text generation and agent work.
- **Interrupted turn:** retry explicitly. T3 aborts the in-flight HTTP stream and keeps the session
  available for a later turn.
- **MCP tool missing:** verify the MCP server on the environment that owns the project. Provider
  credentials and tool execution remain server-side for remote clients.
