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
to hide error and warning messages, including provider status banners, slow-request notices, and
reconnect-failure notices. Provider availability and connection state are unchanged. This device
setting is off by default; turn it off to show future messages again.

## Diagrams and data visualization

Enable **Settings → Better T3 → Chat → Diagrams & data visualization** for the
selected environment. It is off by default; older environments show it as unavailable.
The setting applies to connected web, desktop, and mobile clients and encourages the agent
to use diagrams when they help explain a concept or interpret data.

Ask, for example, “Explain this request flow with a diagram, then help me check my understanding”
or provide a table and ask “Compare these months, show the units, and explain what the data cannot tell us.”
Continue with normal chat questions to ask for a simpler explanation or explore the data.

Mermaid, PlantUML, Graphviz (`dot` or `graphviz`), Vega-Lite, and Vega code blocks appear as
readable previews that you can scroll through or open full screen. Use the diagram actions menu
to export SVG or PNG. Data charts also provide source tables and CSV export. Source tables show
input values, which may differ from aggregated values in a chart. Interactive chart selections
are available full screen.

Keep data inline: external includes, symbol libraries, and map services are not loaded. Each
diagram accepts up to 64 KiB of source and 5,000 data rows. Larger or invalid diagrams retain
their source with an explanation. Charts without source information are marked accordingly;
examples and forecasts should be identified before using a chart to make a decision.

Turning the feature off restores ordinary code blocks without deleting their content. Agent
guidance changes on the next turn. Turning it back on also renders diagrams in older messages.

## Decision models

Environments that support decision models show a dedicated model selector for Auto Reasoning and,
when Project Index is available, under **Settings → Better T3 → Knowledge Automation**. These
selectors include both ordinary text models and provider-native decision models. Native decision
models do not appear in normal agent or text-generation model lists.

Auto Reasoning considers the combined work in a turn, including investigation and verification.
If automatic selection fails, it uses at least medium reasoning when the model supports it.
Choose a reasoning level manually when you want a fixed effort.

The Project Index decision is off by default. When enabled, T3 first retrieves local indexed
context and then asks the selected model whether that candidate is useful for the current prompt.
The prompt and retrieved candidate are sent to that model's provider. A failed decision keeps the
context, so enabling the experiment cannot remove context merely because the provider is
unavailable. The thread activity shows whether context was used, skipped, or retained by fallback.

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

## Reply to chat messages

On web, desktop, and mobile, choose **Reply** on your own message or an assistant message,
or swipe your message left or an assistant message right. You can start anywhere in the message,
including its text. With a mouse or pen, use a quick, straight drag to reply; slower movement,
holding before dragging, or moving across lines keeps text selection. On touchscreens, hold to
select text. Type and send your follow-up after selecting the message. Changing or removing the reply target keeps your draft.

Replies appear in the conversation as a separate topic, so you can follow up while the main
agent keeps working. Reply to a message in that topic to continue it. Each topic uses the main
conversation’s provider, model, and workspace; file changes are shared. Stop or retry a reply
from its topic. Checkpoint restore is unavailable while the main agent or any reply topic is active.

Replies are enabled by default on supported environments. Turn them off for this device under
**Settings → Better T3 → Chat → Reply to chat messages**. Saved reply topics remain in the conversation.

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
