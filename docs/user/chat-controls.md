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

## Voice input

Web and desktop can stream microphone input to AssemblyAI from the chat composer. The waveform and
stop control stay gray while the connection is opening, turn red once the microphone stream is
ready for speech, and return to gray while the final transcript is being finished. Press **Escape**
to cancel and restore the draft from before recording.

In **Settings > Connections > Voice input**, **Output language** can keep the spoken language or
translate the finished transcript to English. **Voice post-processing model** selects the agent model
used only for that optional English translation; AssemblyAI still performs the live speech
recognition. The selection inherits the global text generation model until a dedicated override is
chosen. This setting belongs to the server environment, so configure it on the environment that owns
the project. Mobile does not currently expose voice input.

## Stopping a generation

The stop button uses two stages so an agent gets a chance to finish cleanly without leaving the
user waiting on an unresponsive provider:

1. Select **Stop generation** to request a cooperative stop.
2. Select **Force stop generation** while that request is pending to terminate the active provider
   session immediately.

If the cooperative stop has not settled after five seconds, T3 Code automatically performs the
same force stop. While the force stop is running, the button shows progress and cannot be selected
again. Sending another message remains unavailable until the stop has settled.

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

Enable **Fetch** in **Settings > Experimental** to let supported providers explore repository tasks
with three native subagents in parallel. Fetch gives each subagent a distinct, read-only discovery
scope, allows the primary agent to keep exploring while they run, and requires their findings to be
collected before the first file change. The user message shown in the transcript stays unchanged;
the narrow Fetch mode is attached separately to that provider turn.

Fetch does not run for conversational or other non-repository requests. It also stays inactive when
the selected provider does not advertise support for at least three native subagents. The setting is
device-local, defaults off, and is currently available in web and desktop.

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

Use **Agent count review model** in **Settings > Experimental** to select the provider, model, and
model options used for this estimate. Codex defaults to `gpt-5.6-luna` with low reasoning and the
priority service tier when the provider reports that option. The reviewer supports Codex, Claude,
Cursor, Grok, and OpenCode instances. This experimental control is currently available in web and
desktop; mobile does not yet expose the proposed-plan implementation flow.
