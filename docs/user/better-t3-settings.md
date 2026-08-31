# Better T3 settings

Better T3 settings collect optional Better T3 behavior in one place. Open **Settings > Better T3** on the web or desktop app. On mobile, open **Settings > Better T3** from the native settings screen.

Settings are grouped by what they affect:

- **Interface** contains the synchronized language choice for English, German, French, or the current device language.
- **Agent workflows** includes Fetch and its model, the Auto Reasoning decision model, parallel plan implementation and review, Plan Mode, Deep Thinking, Caveman Mode, prompt improvement, expanded composer controls, reasoning visibility, general subagents, and project-agent coordination.
- **Chat and layout** includes the workspace card deck, card morphing, character streaming motion, chat presentation, the option to keep plans only in the blue Classic composer bubble, Classic sidebar, preview count, sorting and settling, Shift-click Show Less, draft indicators, and left or right sidebar placement.
- **Workspace and source control** includes Git workbench and deck availability, checkpoint status, and links to chat import, export, and harness synchronization.
- **Voice and synchronization** includes AssemblyAI voice input, voice-output language, transcript portability, and a link to credential management.
- **Knowledge and automation** includes the Project Knowledge Graph, its model, indexing progress, pause and resume, rebuild, and clear actions.
- **[Resource protection](resource-protection.md)** includes separate switches for adaptive admission and provider-process suspension, plus a diagnostics link.
- **Integration status** shows remote readiness, lifecycle health, MCP and skills availability, analytics-removal status, and client compatibility.

Switches change optional behavior. Selectors choose a mode or model. Actions perform a bounded operation such as rebuilding the graph. Links open the setting that owns a feature, while status-only rows explain current availability without pretending to be controls.

Character streaming motion applies only to newly arriving assistant text in Classic presentation; reduced motion and Current presentation render it immediately.

**Auto Reasoning decision model** chooses the normal structured text-generation model used to
select an effort. **Automatic** stores no dedicated override and follows the environment's general
text-generation model. This selector never offers the chat-level Auto marker: its own model options
remain concrete so the decision call cannot recursively route itself.

Selected Agent workflows and Chat and layout settings include compact live visuals in their own
setting row. The label and description explain the outcome, the normal switch or selector remains
the only control, and the visual updates immediately beside it. This keeps capability and dependency
messages attached to the same setting instead of separating them into a dashboard. The shared
settings-row visual slot can also be used by other settings pages without introducing a second
interaction model. Only the affected visual replays its motion after a represented value changes.
Motion never loops and resolves directly to the final state when reduced motion is enabled.

## Defaults and existing installations

New installations start with optional Better T3 features disabled. The workspace card deck, character streaming motion, Project Knowledge Graph, and OpenAI Responses provider are off by default.

When an existing installation is upgraded, behavior that was previously implicit stays enabled. Any value you selected explicitly is preserved. A missing setting is migrated once according to the installation type; it does not overwrite a later choice. The sidebar remains on the left unless you move it to the right.

## Turning features off

Feature switches are reversible. Turning a feature off prevents new work from using it, safely drains or cancels work owned by that feature when necessary, and hides UI that is no longer available. Stored preferences and derived data remain available if you turn the feature on again, unless you explicitly use a clear or delete action. Paused work can be resumed, and a disabled feature does not silently discard queued work.

Correctness and safety behavior cannot be disabled. Runtime stop fencing, cleanup, event replay reconciliation, schema validation, authorization, and data integrity always remain active.

## Settings that stay in their owning pages

Provider setup remains under **Settings > Providers**. ChatGPT Subscription, Gemini, OpenRouter, and OpenAI Responses appear under **Additional Better T3 providers** there.

MCP server editing, Git operations, credentials, checkpoints, imports, and destructive project actions also remain on their owning settings pages. Better T3 shows their current availability and provides direct links to the relevant page instead of duplicating those controls.

Some controls are available only when the selected environment supports the required capability. The page explains an unavailable dependency and does not send unsupported commands to an older server. Desktop-only layout controls, such as sidebar position and window decoration spacing, are not shown as active mobile features. Phone and tablet receive the native Better T3 screen and the full-screen Project Knowledge Graph.
