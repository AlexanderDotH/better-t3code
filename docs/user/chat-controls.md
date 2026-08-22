# Chat controls

## Workspace cards

On web and desktop, the bottom workspace is an ordered carousel of equal-size cards. The Chat
composer defines the shared compact height; Git, MCP, and future cards fit that same frame instead
of making the deck taller. A repository thread starts with **Chat**, adds **Git** when the current
environment exposes the Git workbench, and always includes **MCP**. The previous card peeks above
the foreground card and the next card peeks below it. Select either exposed edge to bring that card
forward with a vertical shuffle. The 32 px edges stay in place through compact switches, so
repeatedly selecting the same free point cycles in one direction. Only an exposed edge changes
cards; selecting empty space or content inside the foreground card does not.

The initial order is:

| Foreground | Upper edge | Lower edge |
| ---------- | ---------- | ---------- |
| Chat       | MCP        | Git        |
| Git        | Chat       | MCP        |
| MCP        | Git        | Chat       |

In a non-repository project, or when the server does not advertise Git workbench support, the deck
contains only Chat and MCP. It shows one destination edge at a time and alternates the edge after
each switch. A server without MCP workspace support still exposes the MCP card using locally
available configuration counts, but its expanded view explains that live runtime management
requires a server upgrade and does not issue unsupported runtime requests.

Chat remains mounted while another card is selected, preserving its draft, attachments, provider
settings, and composer state. Returning to Chat restores the previous composer focus. The
foreground content fades out briefly before the slower card shuffle and returns during the motion;
the glass surface, blur, and border remain solid. Reduced-motion preferences switch cards
immediately.

The Git edge keeps Local checkout, environment, worktree, branch, pull-request, repository-state,
and changed-file controls in their familiar positions. Selecting free space or static status on
that edge opens Git, while enabled controls keep their original actions. The MCP edge is one
accessible selection control and summarizes the selected provider account, connected or configured
servers, attention states, and freshness. The internal T3 Code MCP server is not included in these
user-server totals.

Cards cannot leave Chat while voice recording is active. An approval, question, error requiring
action, or another agent-blocking event closes nested non-Chat UI, collapses the expanded panel, and
immediately returns Chat to the foreground. Git and MCP expose their own upward expansion actions;
Git can also be opened by pulling its compact top grabber upward. If an exposed edge is selected
while a panel is expanded, the panel first returns completely to the Chat-defined compact height;
only then does the vertical card shuffle begin. Escape closes a nested dialog first and then
collapses the foreground panel; it never rotates the deck. Mobile keeps its existing composer and
Git controls and does not show the carousel or MCP workspace card.

## Planning with Codex

On web and desktop, enable **Plan mode (legacy)** in **Settings > General > Legacy features** to show
the **Build/Plan** selector for providers that support it, including Codex. **Build** asks the agent
to work directly on the task. **Plan** keeps the thread in a planning workflow so you can explore
requirements and agree on an implementation plan before changing code. The selection is stored per
thread and is sent with the next turn. Mobile keeps its existing interaction-mode behavior and is
not controlled by this setting.

While enabled, the `/plan` and `/default` commands select the same modes. With the composer focused,
**Shift+Tab** switches between them. Turning the setting off hides these controls and runs every
thread in Build mode.

## Model reasoning

On web and desktop, enable **Model reasoning** in **Settings > Appearance** to show reasoning
updates supplied by the selected provider and model. Reasoning appears expanded beneath a small
**Thinking** disclosure and can be collapsed per entry. The presentation is plain chat content,
without a surrounding card, border, or background.

The preference is off by default and stored on the current client. Providers and models that do not
supply reasoning updates continue to show the normal conversation without an empty placeholder.

## Codex context window

Codex chats on web and desktop show a separate **Context** chip beside the other composer controls.
Open it to choose one of 20 stable slider positions, from **Model default** through **1.05M** tokens.
The chip always shows the selected size. **Model default** leaves the context size to Codex and the
active model instead of sending an override.

The selection belongs to the current chat, is stored with its thread, and synchronizes through the
owning T3 environment to web, desktop, and mobile clients. It does not become the default for new
chats. Mobile exposes the same selection in the chat's thread settings. A changed size is applied
when the next Codex turn starts; an existing resumable Codex thread is reopened with that size.

## Voice input

Web, desktop, and mobile can stream microphone input to AssemblyAI from the chat composer. The waveform and
stop control stay gray while the connection is opening, turn red once the microphone stream is
ready for speech, and return to gray while the final transcript is being finished. On web and
desktop, press **Escape** to cancel and restore the draft from before recording. Mobile exposes the
same cancel behavior from its native composer control.

In **Settings > Connections > Voice input**, **Output language** can keep the spoken language or
translate the finished transcript to English. **Voice post-processing model** selects the agent model
used only for that optional English translation; AssemblyAI still performs the live speech
recognition. The selection inherits the global text generation model until a dedicated override is
chosen. This setting belongs to the server environment, so configure it on the environment that owns
the project. On mobile, configure the key, translation model, and device-local English-output switch
under **Settings > Agents & Servers**. The same screen lists each connected environment's project
speech profiles. Expand a project to inspect the active AssemblyAI prompt and context counts, index
or reindex repository terminology, or choose basic context derived only from project metadata.
Indexing extracts terminology and technology names; it does not send source snippets.

## Chat portability

Copying a thread transcript exports the complete, unredacted conversation as Markdown, including
history outside the client's currently loaded message window. On mobile, open the composer's thread
settings and choose **Copy complete transcript**. The action waits until the active turn settles so
the clipboard receives one stable snapshot.

To bring chats across from another local T3 Code installation, open **Settings > Agents & Servers**
on mobile and use **Import chats** for the environment that owns those files. The server scans its
local `.t3` and `.t3-*` data directories and reports the projects, chats, messages, and attachments
it synchronized. Imported chats receive new local IDs and cannot resume the source provider session.
Running the same import again updates the existing imported chats without creating duplicates.

## Stopping a generation

The stop button uses two stages so an agent gets a chance to finish cleanly without leaving the
user waiting on an unresponsive provider:

1. Select **Stop generation** to request a cooperative stop.
2. Select **Force stop generation** while that request is pending to terminate the active provider
   session immediately.

If the cooperative stop has not settled after five seconds, T3 Code automatically performs the
same force stop. While the force stop is running, the button shows progress and cannot be selected
again. Sending another message remains unavailable until the stop has settled.

## Memory protection during parallel agent work

T3 Code protects the server from memory spikes without imposing a fixed agent limit. When the
environment is short on available memory, new Codex turns and subagents remain queued. The affected
thread shows **Subagent wartet auf freien Speicher** for a queued subagent, while Codex reports
**Agent wartet auf freien Speicher** before a queued root turn starts. Every queued start is kept in
arrival order and starts automatically once enough memory is available.

An admitted Codex turn or subagent keeps its memory reservation until that exact turn or subagent
stops. This prevents a short startup measurement from making the same memory look available to
several still-running agents.

If an already running provider grows fast enough to threaten the protected memory reserve, T3 Code
temporarily pauses only that provider process tree. The affected thread shows **Provider
vorübergehend gedrosselt** until the reserve has recovered. The provider then continues from the
same point; its model, reasoning setting, tools, MCP servers, sandbox, and result are unchanged.

There is no configurable agent-count cap. Safe concurrency adapts to current available memory and
the measured growth of the active configurations. A start can wait for as long as memory remains
scarce, and **Stop generation** remains available while it waits or while a provider is paused. The
server owns these decisions, so the same behavior and status apply to web, desktop, and mobile
clients over local, LAN, relay, or tunnel connections.

## Temporarily lowering reasoning effort

After an exploration-heavy completed turn, T3 Code may suggest that **High** reasoning is likely
enough for similar repository discovery. The suggestion appears only when the current provider and
model expose a higher reasoning setting, the thread is idle, and the completed turn consisted almost
entirely of read-only search and file-inspection operations.

Choose **Use High once** to apply High to the next turn only. The composer keeps the reasoning effort
you selected as the thread default and automatically resumes it after that turn. The armed notice
shows both values and offers **Undo** before sending.

Dismissal is tied to the completed turn that supplied the evidence. The suggestion can appear again
only after a later qualifying turn. A manual provider, model, or reasoning-effort change cancels a
pending one-turn override; changing an unrelated option does not.

Suggestion and pending-override state is stored locally by each client. It is not synchronized
between web, desktop, and mobile, and T3 Code never silently lowers the saved thread default.

## Exploring repositories with Fetch

Enable **Fetch** in **Settings > Experimental** to explore a repository before the main provider
starts its turn. The enable switch is device-local, defaults off, and is available in web, desktop,
and mobile. On mobile it appears in the composer settings and under **Settings > Agents & Servers**.
The **Fetch model** selection is stored on the connected T3 environment, so
every client using that environment sees the same provider, model, and traits. Turning Fetch off
disables the selector visually but retains its value.

**Auto** is the default. It shows the selection it currently resolves to and uses this order:

1. A live, non-custom `gpt-5.3-codex-spark` model on the default Codex instance, then another Codex
   instance in stable instance-ID order.
2. A live, non-custom `gpt-5.6-luna` model on a Codex instance, with low reasoning.
3. The environment's configured text-generation model when its current provider instance and model
   are Fetch-capable.
4. The default or first model from the first available Fetch-capable provider instance.

If an automatically selected Spark model reports a typed entitlement or model-unavailable error
before workers start, T3 Code tries Luna with low reasoning once. It does not use that fallback for
timeouts or unrelated provider failures. An explicit selection is always exact: disabling its
provider or losing access to its model produces a visible Fetch warning, skips exploration, and
continues the unchanged main turn without silently substituting another model. **Reset** returns the
selection to Auto.

Fetch is independent of the thread's main model. A Cursor turn can use Claude, Codex, Grok, Cursor,
or OpenCode workers, and every worker in one run uses the same exact selection and model traits. A
hidden structured planner uses that selection too. It gives the main agent first refusal: simple,
focused, or briefly investigative requests use zero workers even when the main agent will read the
repository itself. An explicit request to work alone or avoid Fetch, workers, subagents, or delegation
also uses zero workers. Fetch runs only when parallel exploration materially helps, and then chooses
the smallest useful count between one and the provider's advertised worker budget. Three workers is
not a default. The six built-in providers initially advertise eight; T3 Code has no separate global
ceiling, so a provider or fork may advertise more. An invalid, failed, or timed-out plan safely skips
workers and lets the unchanged main turn continue.

Workers are fresh, transient provider sessions rooted at the project or worktree owned by the
connected environment. They are restricted to read-only exploration, do not receive configured MCP
servers, cannot delegate to nested agents, and are removed after the run rather than resumed later.
The planner itself stays hidden. Actual workers use the existing agent pills and transcript dialog,
including their Fetch origin, provider instance, model, and reasoning or effort. Findings are
collected before the main provider receives the turn, and the main provider remains responsible for
verifying them before editing.

Long-running agent transcripts open with their recent activity so desktop and mobile stay responsive
even after heavy parallel work. Select **Load earlier activity** at the top of the transcript to page
back through older tool and coordination events; messages and proposed plans remain available.

Partial failures and timeouts do not discard successful findings or retry failed workers. If all
workers fail, or no input space remains for their bounded context, the main turn still continues and
Fetch shows a warning. Select **Stop generation** while Fetch is running to interrupt the planner
and exact worker runtimes; the existing second-click force stop and five-second escalation apply.
Each planner or worker session can consume additional quota from the selected provider account.

For remote projects, resolution and execution happen on the T3 environment that owns the project,
using that environment's provider instances, credentials, filesystem, and persisted Fetch model.
The remote client only opts the turn into Fetch, observes its busy state and transcripts, and can
stop it through the normal session controls. Offline mobile turns retain their Fetch choice and run
it on the owning environment after reconnect.

## Coordinating parallel project chats

When multiple root chats are actively working in the same project, T3 Code automatically gives their
agents project-scoped coordination tools. There is no setting or separate coordination panel. Agents
announce a short work summary, claim project-relative paths or named topics before editing, inspect
active peers, and exchange direct or broadcast messages when work overlaps or one result unblocks
another. A root chat working alone receives no coordination instruction and continues normally.

Claims are cooperative warnings, not file locks. Conflicting path claims include exact paths and
parent/child paths, while topic claims match the same normalized topic. A claim lasts only for its
agent's current turn and is released when the turn stops, completes, or the thread is archived or
deleted. Native subagents share their root chat's identity and claim; temporary Fetch workers are not
participants.

Sent and received coordination messages appear chronologically in the normal thread timeline on web,
desktop, and mobile. They are delivered to the other agent's durable inbox and never interrupt or
rewrite its live prompt. The receiving agent checks that inbox at safe checkpoints, so coordination
can influence subsequent work without corrupting an in-progress tool call or edit.

A direct message can also target a peer chat whose agent is no longer running. T3 Code keeps the
message in that chat's inbox and starts a new turn in the same chat so the agent can handle it and
reply. Broadcast messages remain limited to active peers and never wake every inactive project chat.

## Implementing a plan with subagents

Enable **Parallel plan implementation** in **Settings > Experimental** to let supported providers
split a completed plan across native subagents. When a plan settles, T3 Code briefly shows
**Analyzing plan…** while the configured review model estimates how many independent workstreams can
run safely in parallel. The review returns only an agent count; the implementation agent still owns
the actual decomposition, integration, conflict resolution, and final verification.

The primary implementation action uses the reviewed count by default. Its menu still lets you
implement normally, start a new thread, or manually choose any count through the implementation
provider's advertised native-subagent limit. T3 Code does not impose a separate eight-agent limit.

The review waits for at most 20 seconds on the server. If the review model is unavailable, times out,
or returns an invalid result, implementation remains available using the plan's structural estimate;
hover the implementation action to see that fallback. Successful reviews are cached only for the
current app session and are refreshed when the plan version, implementation provider capability, or
review-model selection changes.

Use **Agent count review model** in **Settings > Experimental** on web and desktop, or **Parallel
plan review** under **Settings > Agents & Servers** on mobile, to select the provider, model, and
model options used for this estimate. Codex defaults to `gpt-5.6-luna` with low reasoning and the
priority service tier when the provider reports that option. The reviewer supports Codex, Claude,
Cursor, Grok, and OpenCode instances. Mobile shows the same reviewed default and provider-native
agent-count choices on proposed plans.
