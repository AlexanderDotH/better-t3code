# MCP servers

Open **Settings > MCP Servers** or expand the **MCP** workspace card in a web or desktop chat to
manage tool servers. Definitions belong to the environment that runs them. Select a provider account
and choose whether a server applies globally or only to a project.

A definition can be assigned to every provider account or only selected accounts. **All** also
includes accounts created later. The master switch disables a server for every account without
removing its configuration. Create separate definitions when accounts need different credentials.

Use **Import** to discover configurations on the environment. Export produces Cursor-compatible
JSON. Shared definition edits affect every assigned account; account assignment changes affect only
that account.

## Inspect a running session

The workspace card shows configured servers when there is no live runtime. Expand it to inspect a
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

On native mobile, **Settings > Agents & Servers** manages configured server enablement. The workspace
card and live-runtime management are available on web and desktop.
