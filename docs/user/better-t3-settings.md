# Better T3 settings

Better T3 settings collect optional Better T3 behavior in one place. Open **Settings > Better T3** in the web or Electron desktop app. The selected environment stays above eight responsive tabs:

- **General** contains the synchronized interface-language choice.
- **Agents** contains agent workflows, model choices, planning modes, and agent coordination.
- **Visual** contains chat presentation, motion, previews, sorting, and sidebar layout.
- **Workspace** contains Git workbench, checkpoints, and chat portability.
- **Voice** contains AssemblyAI dictation, output language, transcript portability, and credentials.
- **Knowledge** contains the Project Knowledge Graph and its indexing controls.
- **[System](resource-protection.md)** contains resource-protection controls and diagnostics.
- **Integrations** contains remote, lifecycle, MCP, skills, analytics, and compatibility status.

Each tab shows its basic settings first. Tabs that need deeper configuration also include an **Advanced settings** section, which is collapsed by default. Opening it keeps advanced settings visible while you move between tabs during the current page visit; returning to the page starts with it collapsed again. General does not show an empty advanced section.

For example, **Knowledge Graph** is the basic setting that turns the feature on or off. Its model, indexing progress, rebuild, pause or resume, and clear controls are advanced settings. Agents exposes **Auto Reasoning evaluation model** directly, while Fetch model, the parallel-plan reviewer, and Caveman Mode remain under Advanced. Visual keeps card morphing, preview count, sorting, settling, and Shift-click Show Less there. Workspace uses it for checkpoints and portability, Voice for output language, transcript portability, and credentials, System for diagnostics, and Integrations for MCP and Skills links.

Settings search selects the tab containing its result automatically. If the result is advanced, the Advanced settings section expands so the setting can be focused.

Mobile keeps its native Better T3 settings routes and section layout instead of using the web tabs.

Switches change optional behavior. Selectors choose a mode or model. Actions perform a bounded operation such as rebuilding the graph. Links open the setting that owns a feature, while status-only rows explain current availability without pretending to be controls.

Character streaming motion applies only to newly arriving assistant text in Classic presentation; reduced motion and Current presentation render it immediately.

**Auto Reasoning evaluation model** chooses the structured text-generation model that analyzes the
current prompt, attachment metadata, and exactly the three latest earlier user or assistant messages
in chronological order. The current prompt does not count as one of those three messages.
**Automatic** stores no dedicated override and follows the environment's general text-generation
model. This selector never offers the chat-level Auto marker: its own model options remain concrete
so the evaluation call cannot recursively route itself. Auto remains a Codex-only main-turn option,
but every supported structured text-generation provider can supply the evaluation model.

Selected Agent workflows and Chat and layout settings show two compact visual choices below the
setting title and description. Click the preview for the result you want; the selected card exposes
radio state to assistive technology, and the old switch or dropdown is not duplicated. Capability and
dependency messages stay attached to the same setting, while settings without useful previews keep
their normal controls. Only the affected visual replays its motion after a represented value changes.
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
