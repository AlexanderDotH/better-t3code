# Delegate work to subagents

Ask the main agent to delegate independent tasks when parallel work would help, for example an
implementation task and a focused review. Enable the general-subagent feature in
**Settings → Better T3 → Agents** where the environment supports it.

A subagent normally uses the parent's provider, model, workspace, and permission mode. The main
agent can select another available provider and model for a task. Provider credentials and all
execution remain on the project's environment, including when you connect remotely. Available
delegation tools depend on the initiating provider; a provider that can run a worker does not
necessarily offer tools to create more workers.

On web and desktop, choose your display in
**Settings → Better T3 → Agents → Native T3 Code subagent display**.
Turn it on to use the native **Agents** panel, or off to use Better T3's floating agent pills.
Click a pill to inspect its transcript. This switch does not change delegation or agent history.

The main agent remains responsible for reviewing those results, integrating changes, and verifying the complete task.
A subagent that cannot proceed within its permissions reports the blocker to the main agent.

Stopping the parent turn cancels its unfinished delegated work. Completed results remain in the
thread history. Subagents can search project memory, while the root agent owns changes to it when
agent writes are enabled.

For read-only repository exploration before a turn, enable **Fetch** in
**Settings → Better T3 → Agents** and choose its model there. Subsequent requests can gather
repository context before the main agent starts. Turn Fetch off in the same settings to skip that
preparation. Fetch does not replace a subagent assigned to edit or test code.
