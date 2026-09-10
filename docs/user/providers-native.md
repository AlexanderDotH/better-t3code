# Native providers

Open **Settings → Providers**, select the environment that will run your work, and add or enable
the provider. Credentials and tools belong to that environment, including when you control it
from another device. Add separate instances for separate accounts or configurations.

## ChatGPT subscription

Choose the **ChatGPT** provider and use its sign-in action. Install Codex CLI on the environment
if the login helper is unavailable, or set its binary path in provider settings. Local environments
can use browser sign-in; remote connections use the offered device-code flow.

Each ChatGPT instance keeps its own managed login. It does not automatically reuse the default
Codex provider's account. Check the reported account after signing in. Disconnect or reconnect from
the same provider settings. This provider uses your ChatGPT subscription; the **OpenAI** provider
below uses an API key instead.

## OpenAI API

Add an API key through the **OpenAI** provider's account controls, then refresh its status and
choose an available model. You can instead set `OPENAI_API_KEY` in that instance's environment
variables. A key saved through the account controls takes precedence over the instance variable.
Mark environment-variable credentials as sensitive.

Replace or remove a saved key in the same account controls. If the instance uses an environment
variable, change or remove that variable instead. The provider reports which source is in use.

## OpenRouter

Use the **OpenRouter** provider for a direct connection. Add an API key or follow its offered
sign-in flow. `OPENROUTER_API_KEY` in the instance's environment variables is also supported;
a saved account key takes precedence.

After authentication, choose **Default model** in the provider configuration. You can browse the
available catalog while this choice is missing, but the provider is not ready for a turn until a
default is configured. Refresh provider status after changing credentials or model access.

In the OpenRouter model picker on web and desktop, narrow the catalog by agent readiness,
capabilities, author, minimum context size, or favorites, and choose its sort order. Text search
applies within those filters. Use **Reset filters** if a model you expect is hidden.

A [Claude instance routed through OpenRouter](./providers-claude.md#openrouter) is a separate setup
and continues to use Claude Code and its configuration.

## Gemini

The **Gemini** provider uses the server's bundled Google SDK; no Gemini CLI or browser login is
required. Set `GOOGLE_API_KEY` or `GEMINI_API_KEY` in the instance's environment variables, mark it
sensitive, and refresh provider status. If both variables are set, `GOOGLE_API_KEY` wins.

For the Google sign-in choices offered by **Antigravity**, use the
[Antigravity guide](./providers-antigravity.md). Those accounts and settings are separate from this
Gemini API provider.

## OpenAI Compatible

Add **OpenAI Compatible** in **Settings → Providers** to connect directly to an OpenAI-compatible
endpoint. Set a name, its **Base URL** (including the API path, usually `/v1`), and a **Default model**.
Choose a model returned by the endpoint or enter its exact model ID manually if the list is empty
or unavailable. A host-only URL gets `/v1` automatically; an existing proxy path is preserved.
URLs must use HTTP or HTTPS and must not contain a username or password.

Add an API key only if the endpoint requires one. Saved keys belong to that instance and Base URL.
Replace or remove a key in the same account controls. Changing the Base URL does not send the old
key to the new address; save a key for the new address if needed. Saved conversations resume with
their original instance and URL; start a new thread for a different endpoint.

This native provider supports text conversations and T3 tool execution through Chat Completions.
Choose an endpoint and model that support streamed tool calls. The connection runs on the selected
T3 server, so the Base URL must be reachable from that machine. Image and audio attachments are
not supported. Plan mode keeps the workspace read-only; approval settings apply to tool execution.

## LM Studio

Add **LM Studio** for a separate native connection to an LM Studio server. The default **Base URL**
is `http://127.0.0.1:1234/v1`; change it to the LM Studio machine's address when it runs elsewhere.
Set a name and **Default model**, choosing from the model list or entering an exact model ID.
An API key is optional and stored securely per instance when supplied. This provider supports
the same text, tool, approval, and key-handling behavior as OpenAI Compatible above.

Start the LM Studio server yourself before connecting. Its
[quickstart](https://lmstudio.ai/docs/developer/rest/quickstart) covers server setup and optional
authentication; T3 uses its
[OpenAI-compatible API](https://lmstudio.ai/docs/developer/openai-compat).

### Discover local and LAN endpoints

Opening either provider's setup starts discovery. Use **Discover endpoints** in an existing
connection's settings to search again. Choose **Use endpoint** to fill the form, review the model
and any required key, then save. Existing connections are marked and remain unchanged. A protected
candidate marked **Unverified** still needs validation with its key.

Discovery runs on the **T3 server**, including from a phone or remote browser. It checks IPv4 and
IPv6 loopback plus directly connected private IPv4 networks on ports `1234`, `11434`, `8080`,
`8000`, and `1337`. Tunnel, VPN, and container interfaces are excluded. Subnets with at most 1,024
addresses (`/22` or a longer prefix) are covered in full; larger networks use the server's local
`/24`. A scan checks at most 1,024 LAN hosts, with 32 probes at a time, two seconds per HTTP probe,
and a 45-second total limit. A limitation notice means results may be incomplete.

Results are reused for 60 seconds; **Rescan** requests a fresh search. Concurrent clients share an
active scan. You can cancel your search; another client may still be using the same scan.

Use a manual Base URL for a host outside that range, an IPv6 LAN address, or a custom port.
Discovery checks model catalogs without sending API keys or generating responses. It does not
start servers or load models.

## Tools and existing conversations

ChatGPT, OpenAI, OpenRouter, OpenAI Compatible, and LM Studio support configured
[MCP servers](./mcp-servers.md). Gemini currently does not expose that integration. Each provider only
offers the tools and model options its current connection supports.

These native providers keep their T3 conversations in the environment. They do not import arbitrary
old conversations from the providers' websites. To bring supported local histories into T3 Code,
use [chat import and harness sync](./chat-import.md).
