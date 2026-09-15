# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, and Grok Build session history from your connected
environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent
cost. These estimates are not your subscription bill.

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** pools every subscription account it can see per provider, so with several Codex
or Claude accounts across your environments and hubs you read one number per window rather than a
list. Each window card shows how much of the pool is left and a bar with one segment per account,
kept in the same column across windows. Accounts are ordered by their 5-hour reset, soonest
first, or by the first available window when no account reports a 5-hour limit. A gap means the
account does not report that window. When the provider reports reset times, the card also says
when the next reset lands and how much it hands back. The hatched
part of a segment is what that reset restores. Tap a segment or account row for the account's plan,
where it is signed in, and its reset time. On web, you can hover too. Codex accounts with banked
reset credits show a ticket count and the **Use reset** action in the account details. On narrow screens, numbered rows below
the bar show each account's quota, countdown, and credits. Tap a row to open its details.

The same account signed in on more than one environment, or reported by a hub as well, counts once.
Filter with the environment dropdown to see what a single machine has.

If a window looks stale, refresh Limits to re-check every provider and hub.

Enable **Show usage pace** in **Settings → Better T3 → Usage → Usage limits and pacing**
(on mobile, **Settings → Better T3**). Unused daily shares from earlier days in the current weekly
window are available immediately as **catch-up**. Today's allowance includes that catch-up once;
the rest of the remaining weekly quota is spread across the days until reset, including weekends.
The default 8-hour workday starts at the first recorded usage each local day; switch it off to
spread usage over a full 24-hour calendar day. Pace guidance flags spending that would exhaust
today's allowance too early, showing how far above the catch-up-adjusted pace you are in percent.
Hover or tap it for the hourly allowance, observed usage, and remaining catch-up. Catch-up is
part of your existing weekly quota and expires at reset; it does not increase your provider's limit.
These percentages are shares of subscription quota, not fixed token counts. Codex pacing uses
the CLI's timestamped token usage and quota history, including activity outside T3 and before
a restart. Missing history, including activity on another machine, is not inferred from T3
messages. Other providers use quota observations from the running server.
Five-hour limits appear alongside weekly limits whenever the provider reports them and keep
their own reset clock.

Turn on **Hard daily budget** in the same settings section to enforce today's allowance,
including catch-up. It is off by default and applies to all clients connected to the selected
environment, using that environment's calendar day. Reaching the allowance blocks new agent
turns and background generation, and interrupts active agent turns when the next usage update
arrives. The next day makes a new allowance available; switching the setting off removes the
block immediately. It works independently of the pace display and the 8-hour pacing guide.
When weekly usage or sufficient history cannot be verified, requests are blocked until the data
is available or you disable the setting. This includes providers without weekly subscription
limits. Usage reporting and cancellation can lag, so in-flight work may exceed the allowance.
The setting only controls requests made through this environment; it cannot stop other apps
using the same account.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
stays pinned across chats and new messages until you dismiss it. It follows the current chat's
provider and updates with **Usage → Limits**, keeping the last known limits and matching usage
history when a refresh cannot read them. Opening it does not run the agent or trigger a refresh.
The command is offered only for providers that appear under **Usage → Limits**.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. Codex accounts show banked reset credits; select an
account and choose **Use reset** to redeem one. No hub plugin is required.

This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.
