# MCP servers

T3 Code stores each user-configured MCP server once in the environment that owns its commands,
URLs, headers, and secrets. Provider accounts then receive assignments to those shared definitions.
Configuration is never owned by a chat, and it is not copied between environments.

This allows two accounts backed by the same provider driver to have independent assignments. If the
accounts need different credentials or transport settings, create two server definitions and assign
one to each account.

## Assignment and project scope

Open the **MCP** workspace card from a web or desktop chat, or open **Settings > MCP Servers** for
environment-wide management. Select a provider-account tab before changing assignments. A server
can be:

- enabled for every provider account in the environment;
- enabled only for selected provider accounts; or
- disabled everywhere with its master switch.

Routing mode **All** automatically includes provider accounts created later. Once routing is
customized to **Selected**, future accounts remain disabled until explicitly added. Definitions
written by older clients without routing information continue to decode as **All**, and an older
client editing another field does not erase an existing selected-account assignment.

Each definition is either global or scoped to a project. A project-scoped server is applicable only
when a runtime belongs to that project. Changing the shared definition changes its command or
connection details for every assigned account; changing an assignment affects only the selected
account.

## MCP workspace card

The exposed MCP edge identifies the selected provider account and reports a textual summary rather
than relying on color. With an exact live session it shows connected versus expected user servers
and the number requiring authentication, setup, recovery, refresh, or configuration reconciliation.
Without a live session it reports the applicable configured count and **next session** status. It
also distinguishes disconnected, unsupported, configuration-only, and upgrade-required states.
The locked internal T3 Code MCP server is never included in user-server totals.

When MCP is in the foreground, its compact body has exactly the same height as Chat and does not
scroll. It shows the disambiguated provider account, applicable configured count, connected versus
expected count, attention count, known tool count, and freshness. Tool count remains **Unknown**
until the exact runtime reports it; absence of inventory is not displayed as zero.

Use the upward action to expand MCP into the management workbench. The panel starts at about 62% of
the chat column, resizes vertically, remembers its height on this device, retains the neighboring
card edges, and leaves the right-side file panel independent. While expanded, it hides the terminal
drawer without closing its session and restores it on collapse. Switching cards first collapses MCP
back to Chat's compact height. The expanded panel has two sections:

- **Servers** filters global and current-project definitions and supports create, edit, duplicate,
  delete, account assignment, master enablement, import, and export. Results distinguish live apply
  from changes saved for a future session.
- **Runtime** selects an exact provider session, groups T3-managed, provider-native, and locked T3
  system servers, and offers the runtime-supported refresh, reconnect, and authorization actions.
  Tool, resource, template, version, and sanitized issue details load only when disclosed.

The workbench initially follows the chat's provider account and exact runtime. Selecting another
provider tab is local to MCP and does not change the provider used by Chat. If a selected runtime
ends or is replaced, it remains identified as ended until the user chooses another session; runtime
actions are never silently redirected.

Users with orchestration read access can inspect the workbench. Configuration and runtime actions
require operate access and remain disabled with an explanation for read-only users. Settings stays
available for managing all projects in the environment.

## Configured and live status

Configuration and runtime health are different facts:

- **Configured for next session** means T3 Code will pass the server to a matching future provider
  session.
- **Connected** means that exact provider runtime reported a usable MCP connection.
- **Authentication required** means the server was delivered but the provider needs a fresh login.
- **Pending live apply** or **configuration drift** means the durable configuration changed but the
  complete desired live set has not yet been confirmed.
- **Status unavailable** means the provider accepts configuration but does not expose per-server
  health. It does not mean the server is connected or broken.

T3 Code attempts to reconcile create, edit, delete, master enablement, assignment, and import changes
across matching live sessions when their provider supports it. A result is **Applied** only after the
provider confirms the complete managed-server set. Otherwise the workbench reports **Pending for
next session**, **Unsupported**, or a sanitized failure. T3 Code never restarts a provider session to
apply an MCP setting.

Inactive runtime contexts are a bounded convenience cache, not durable history. The environment
retains active entries plus at most 20 recently updated inactive contexts per provider and expires
inactive contexts after 24 hours. Runtime health is not written to the configuration file or
database.

## Compatibility and remote authorization

Runtime capabilities are negotiated with the environment instead of inferred from the provider's
name. When the server does not advertise MCP workspace version 1, the card remains visible with
locally available configuration counts, performs no new runtime or context requests, and shows an
upgrade-required configuration-only expanded view. Legacy MCP Settings remains reachable.

Authorization opens only a provider-supplied URL; credentials and OAuth state remain on the
environment server. If the provider requires a callback available only on the host, a remote,
relay, or tunnel client is directed to finish authorization on that host instead of receiving a
button that cannot complete safely.

The native mobile app keeps its existing UI and does not expose the workspace deck or MCP management
card.
