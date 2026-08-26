# OpenCode

This guide covers practical OpenCode setup for additional provider instances in T3 Code.

## Use OpenCode With Google (Gemini)

Authenticate Google in OpenCode first, from the same operating-system account that runs T3 Code:

```sh
opencode auth login --provider google
opencode auth list
```

The interactive login stores the credential in OpenCode's own credential store; the second command
should list **Google**. This is the usual setup for the `google/...` Gemini provider.

For an OpenCode instance that T3 Code starts locally, its **Environment variables** are also passed
to OpenCode. Use those only when your upstream provider's OpenCode setup specifically requires
environment variables (for example, a Vertex AI configuration); mark sensitive values as sensitive.
Stored OpenCode credentials can take precedence over environment values.

If the OpenCode instance uses a configured **Server URL**, T3 Code connects to that existing server.
Configure Google credentials on the host running that server; T3 Code cannot inject its instance
environment variables into a remote OpenCode process.

## Local Servers and Plugins

OpenCode servers started and owned by T3 Code run in OpenCode's pure mode. Your normal OpenCode
configuration, credentials, agents, and skills remain available, but external OpenCode plugins are
not loaded. This keeps plugin hooks from rewriting T3 Code prompts or creating additional OpenCode
sessions outside the thread's turn lifecycle.

To use external OpenCode plugins intentionally, start and manage your own `opencode serve` process,
then configure its URL as the instance's **Server URL**. T3 Code connects to that server without
changing its plugin policy or owning its process lifecycle.

After authenticating, use the OpenCode instance in Chat and pick model slugs like
`google/gemini-2.5-flash` in the model list. OpenCode model selection in T3 Code expects
the format `provider/model`.

If the model list does not include `google/...`, run **Refresh provider status** on the
OpenCode instance so T3 Code re-reads the current `opencode models --verbose` output.
