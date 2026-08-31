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
T3 Code uses the OpenCode setup on the connected environment. With a remote environment, its
OpenCode login and configuration apply, not the setup on your desktop or phone.

T3 Code requires OpenCode 1.14.19 or newer. It checks the server version before it loads models or
starts work. If the check fails, update OpenCode or fix the server URL and password, then refresh
the provider status. Reconnecting the client also runs the check again.

## Workspace tools

OpenCode receives T3's authenticated `workspace_context` tool for batched search and bounded reads.
Writable sessions also receive one `workspace_edit` tool for single-file or mixed UTF-8 write,
replacement, range-edit, and delete batches. Read-only, approval-required, and Fetch sessions
receive only the read tool. A Plan turn rejects edits before disk access even if its existing
writable session still lists the tool. The tools always operate on the project environment,
including when the OpenCode server or controlling client is remote.

## Server authentication

Without a server URL, T3 Code starts a local OpenCode server. The process inherits
`OPENCODE_SERVER_PASSWORD` from the environment. A password in the provider settings overrides
that environment value for both the local process and T3 Code.

With a server URL, T3 Code connects to that external server and uses only the password in the
provider settings. It does not send a local `OPENCODE_SERVER_PASSWORD` to an external server.
OpenCode uses this password for HTTP Basic authentication.

## Refresh the model list

T3 Code loads the model list when an enabled OpenCode provider starts and keeps the list in its
cache. Reconnecting a client or using a refresh control asks OpenCode for the list again. The
periodic provider health setting does not refresh OpenCode's catalog.

After changing an OpenCode login or configuration outside T3 Code, open **Settings > Providers**,
select the environment, and choose **Refresh provider status**. Changing the provider's
configuration in T3 Code also replaces that provider connection.

On mobile, open the thread settings and select **Refresh models**. The control stays disabled while
the refresh runs and shows an error if the refresh fails.

OpenCode reads credential changes on each model-list request. Native OpenCode configuration files
can stay cached while the local helper is running. The helper closes after 30 seconds with no
model-list or text-generation work. Refresh after that idle period to start a new helper and read
the file changes. Repeated refreshes or active helper work can extend this wait.

T3 Code does not own an external OpenCode server. Native configuration changes on that server can
require its own reload or restart before a refresh returns the new list.

If a refresh fails, T3 Code keeps the last known models, slash commands, and skills. Fix the
connection, then refresh again. A successful refresh can remove entries that OpenCode no longer
offers.

## Continue an existing thread

An existing thread keeps its selected model and options when that model is temporarily absent
from the catalog. The web picker shows an **Unavailable** row and keeps saved option values visible
until the model metadata returns. T3 Code does not switch the thread to the first model in the
list.

The stored selection does not guarantee that OpenCode can still run the model. If the provider
rejects it, select an available model before trying again.
