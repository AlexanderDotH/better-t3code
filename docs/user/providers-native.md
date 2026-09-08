# ChatGPT, OpenAI, OpenRouter, and Gemini

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

A [Claude instance routed through OpenRouter](./providers-claude.md#openrouter) is a separate setup
and continues to use Claude Code and its configuration.

## Gemini

The **Gemini** provider uses the server's bundled Google SDK; no Gemini CLI or browser login is
required. Set `GOOGLE_API_KEY` or `GEMINI_API_KEY` in the instance's environment variables, mark it
sensitive, and refresh provider status. If both variables are set, `GOOGLE_API_KEY` wins.

For the Google sign-in choices offered by **Antigravity**, use the
[Antigravity guide](./providers-antigravity.md). Those accounts and settings are separate from this
Gemini API provider.

## Tools and existing conversations

ChatGPT, OpenAI, and OpenRouter support configured [MCP servers](./mcp-servers.md). Gemini currently
does not expose that integration. Each provider only offers the tools and model options its current
connection supports.

These native providers keep their T3 conversations in the environment. They do not import arbitrary
old conversations from the providers' websites. To bring supported local histories into T3 Code,
use [chat import and harness sync](./chat-import.md).
