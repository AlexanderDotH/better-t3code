# Better T3 settings

Open **Settings → Better T3** to choose optional agent workflows, chat presentation, workspace
features, speech, and resource limits. The page shows which features the selected environment
supports and links to their detailed settings.

Device settings affect the client you are using. Environment settings affect work on the selected
server and are shared with its connected clients. Select the intended environment before changing
those settings. A disconnected or read-only environment can still be inspected, but its settings
cannot be changed here.

Some features depend on another feature being enabled. Enable the indicated dependency first.
Turning a feature off does not remove its saved conversations or project data.

## Suppress Errors and Warnings

On web and desktop, enable **Settings → Better T3 → General → Suppress Errors and Warnings**
to hide error and warning pop-ups, including slow-request and reconnect-failure notices.
Connection status and recovery controls in the chat remain visible. This device setting is off
by default; turn it off to receive future pop-ups again.

## Diagrams and data visualization

Enable **Settings → Better T3 → Chat → Diagrams & data visualization** for the
selected environment. It is off by default; older environments show it as unavailable.
The setting applies to connected web, desktop, and mobile clients and encourages the agent
to use diagrams when they help explain a concept or interpret data.

Ask, for example, “Explain this request flow with a diagram, then help me check my understanding”
or provide a table and ask “Compare these months, show the units, and explain what the data cannot tell us.”
Follow-up actions prepare an editable message and preserve your existing draft.

Mermaid, PlantUML, Graphviz (`dot` or `graphviz`), Vega-Lite, and Vega code blocks appear as
previews that can be opened full screen and exported as SVG or PNG. Data charts also provide
source tables and CSV export. Source tables show input values, which may differ from aggregated
values in a chart. Interactive chart selections are available full screen.

Keep data inline: external includes, symbol libraries, and map services are not loaded. Each
diagram accepts up to 64 KiB of source and 5,000 data rows. Larger or invalid diagrams retain
their source with an explanation. Charts without source information are marked accordingly;
examples and forecasts should be identified before using a chart to make a decision.

Turning the feature off restores ordinary code blocks without deleting their content. Agent
guidance changes on the next turn. Turning it back on also renders diagrams in older messages.

## Thinking traces

On web and desktop, go to **Settings → Better T3 → Chat → Thinking trace display**.
Choose **No thinking traces**, **In chat** to read full traces including completed turns,
or **In Working dialog** to follow the latest live thoughts automatically.
Both visible modes use your character streaming setting.

## Edit chat messages

In web and desktop chats, use **Edit message** beside a completed user or assistant message.
Edit the text directly in the conversation and choose **Save correction**. This replaces the
message in place, preserving its role, attachments, and later messages. Saving does not start the
agent or add a correction message. Your next message uses the corrected conversation. Wait for
the agent to finish before editing. The separate fork action remains available to branch a chat.

This is enabled by default. Turn it off under **Settings → Better T3 → Chat → Edit chat messages**.

## Composer controls

On web and desktop, open **Settings → Better T3 → Composer** to arrange the input area. Enable
**Expanded composer controls** to show separate model and mode controls where space allows;
narrow layouts use the compact menu. The same section contains the workspace card deck,
context-window selector, plan bubble, and prompt improvement.

Use [appearance and language](./appearance.md#language-and-chat-layout) for visual preferences,
[resource protection](./resource-protection.md) when work waits for memory, and
[delegated work](./general-subagents.md) to follow subagent tasks. Set up
[dictation](./composer.md#dictate-and-refine-a-prompt) under **Better T3 → Voice**, including the
AssemblyAI key, translation model, and project speech context for the selected environment.
