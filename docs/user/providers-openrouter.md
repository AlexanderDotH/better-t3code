# OpenRouter (Early Access)

OpenRouter lets T3 Code use an OpenRouter API key with a model selected from the live OpenRouter
catalog. T3 remains the agent harness: it owns conversation history, approvals, workspace tools,
configured MCP servers, project coordination, subagents, and Fetch workers.

This provider is **Early Access**. Chat Completions is the default protocol. OpenResponses is
available as an explicitly selected beta option.

## Connect an API key

1. Open **Settings > Providers** on the environment that will run the agent.
2. Add **OpenRouter**, paste an OpenRouter API key into the credential field, and select **Save**.
3. Wait for the provider card to show the masked key label.
4. Open the chat model picker, select OpenRouter in the provider rail, then choose a compatible
   model from the live catalog. That first selection becomes the provider instance's default.

Use a standard OpenRouter inference API key from the **Keys** page. OpenRouter Management API keys
are valid administrative credentials, but OpenRouter does not allow them to call model completion
endpoints. T3 rejects those keys during connection with an explanation instead of accepting them
and failing on the first turn.

The provider remains in a warning state until a default model is selected. It cannot start turns,
subagents, text generation, or Fetch workers while that selection is missing or no longer valid.

The server stores a submitted key for only that provider instance. The key is never returned to the
client. As an alternative, add a sensitive `OPENROUTER_API_KEY` variable to the provider instance's
environment. A stored key takes precedence over the environment value.

## Protocol and routing

- **Chat Completions** is the stable default and supports T3's complete tool loop.
- **OpenResponses** is beta. Changing protocol starts a new upstream sequence from T3's visible
  transcript; protocol-specific hidden reasoning is not translated between formats.
- T3 always sends the exact selected model. It does not add a fallback model list.
- OpenRouter may still route that model across its available hosting providers. Settings can retain
  OpenRouter defaults, choose an ordered provider list, or sort endpoints by price, throughput, or
  latency.
- Optional settings constrain fallback behavior, data collection, Zero Data Retention, performance,
  and maximum price. An untouched privacy setting inherits the OpenRouter account policy.

Context compression is disabled by default, including when OpenRouter would otherwise apply its
middle-truncation transform. Enable it only when losing older middle content is acceptable.

## Workspace tools

OpenRouter receives T3's `workspace_context` read tool and, for writable turns, one `workspace_edit`
tool for single-file or mixed UTF-8 write, replacement, range-edit, and delete batches. T3 executes
the tools locally rather than asking OpenRouter to host a shell or filesystem. Plan mode, read-only
sessions, and Fetch workers receive only the read tool. The same behavior applies when the
controlling client is remote because the project environment remains the executor.

## Model catalog, filters, and favorites

T3 shows the complete OpenRouter catalog, including entries that cannot run a T3 agent turn.
Incompatible entries remain visible with an explanation, but cannot be selected as the default or
used for a turn. Open the model picker and select the OpenRouter icon in its provider rail to open
the dedicated catalog page. The catalog stays available while an authenticated OpenRouter instance
is waiting for its first valid model selection. Provider settings keep connection, custom-model,
and routing configuration; they do not duplicate the catalog browser.

On web and desktop, the catalog page keeps search scoped to that OpenRouter instance and supports
**Agent ready**, **Free**, **Reasoning**, **Vision**, context-size, creator, favorites-only, and sort
controls. Filters combine, so enabling **Free** and **Vision** shows models that satisfy both. Turn
off **Agent ready** to inspect incompatible catalog entries. On mobile, selecting OpenRouter opens a
dedicated catalog page with search, **All**, capability, context, and favorites filters.

Use the star beside a model to add or remove a favorite. Favorites are scoped to the provider
instance, so the same model can be favorited independently for personal and work OpenRouter
instances. Web, desktop, and mobile each retain their own picker favorites.

## Custom models and presets

Add an exact custom model or preset slug when it is not present in the live catalog. Custom entries
are marked as unverified, and a request fails visibly if OpenRouter cannot honor T3's required tool
parameters.

## Disconnect or replace a key

Submitting a replacement key validates it before replacing the stored credential. A rejected or
unreachable replacement leaves the previous key intact.

Select **Disconnect** to remove a stored key. An environment-backed key remains connected until the
sensitive environment variable is removed from that provider instance.

## Troubleshooting

- **Invalid or Management API key:** create or copy a standard inference API key from OpenRouter's
  **Keys** page, then submit it again. Management API keys only administer other keys and cannot run
  model completions.
- **Payment required:** review the key's credit or spending limit in OpenRouter. T3 does not switch
  to another model or account automatically.
- **No models:** refresh the provider after confirming network access and key validity.
- **Default model missing:** choose another catalog model, or add the exact model or preset slug as a
  custom entry before selecting it.
- **Context too large:** reduce the conversation or explicitly enable context compression. T3 never
  silently truncates the local transcript.
