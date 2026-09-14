# MCP servers

Open **Settings > MCP Servers** or expand the **Tools & skills** workspace card in a web or desktop chat to
manage tool servers under **Installed > MCP servers**. Definitions belong to the environment that runs them. Select a provider account
and choose whether a server applies globally or only to a project.

A definition can be assigned to every provider account or only selected accounts. **All** also
includes accounts created later. The master switch disables a server for every account without
removing its configuration. Create separate definitions when accounts need different credentials.

Only provider accounts enabled in Settings appear in the MCP provider picker. Existing MCP servers
in Codex, Claude, Cursor, Grok, and local OpenCode configuration files are discovered automatically
on the selected environment. Choose **Global** or **Project** to inspect the corresponding files.
They appear under **Provider-managed servers**, with their source file, even before a session starts.
Edit them through their provider, or use **Import** to copy a configuration into T3-managed definitions.
Plugins, provider compatibility layers, and remote OpenCode servers appear when a live session reports them.

Export produces Cursor-compatible
JSON. Shared definition edits affect every assigned account; account assignment changes affect only
that account.

Configured MCP servers are supported by Codex, Claude, Cursor, OpenCode, ChatGPT, OpenAI, and
OpenRouter. Gemini, Grok, and Antigravity currently do not expose this integration. Choose a
supported provider account when you need these tools.

## Find and install servers

Open **Browse** in the chat card or MCP settings to search the
[official MCP Registry](https://registry.modelcontextprotocol.io). Choose **Set up**, review the
source, select a connection and provider, and fill in the requested configuration. Catalog setup
offers active providers only; **All active providers** selects the accounts available at install time.
Remote servers
may need an account; local packages require Node.js or uv on the environment host. The installation
result tells you whether a live session was updated or a new session is needed.

Servers with other installation methods link to their source instructions for manual setup through
**New**. The store runs against the selected environment, including remote environments. Update an
older environment's server if its store is unavailable.

## Inspect a running session

Open the card's **Diagnostics** tab to inspect a
specific provider session, view tools and connection issues, or use the provider's supported refresh,
reconnect, and authorization actions. Selecting another provider here does not change Chat's
provider. An ended session is not silently replaced with another session.

**Connected** means the selected runtime confirmed a usable connection. **Pending for next session**
means configuration was saved but the runtime has not confirmed it. **Status unavailable** means the
provider does not expose server health. Unknown tool inventory is not treated as zero tools.
Configuration changes are applied live when supported; T3 Code does not restart a session to apply
them. The internal T3 server is locked and excluded from user-server totals.

Read access permits inspection; configuration and runtime actions require operate access. Remote
clients must complete host-only authorization on the environment's host. Credentials remain there.
Older servers retain configuration management and show when an upgrade is needed for live status.

On native mobile, **Settings > Agents & Servers** manages configured server enablement and lists discovered global provider servers. The workspace
card and live-runtime management are available on web and desktop.
