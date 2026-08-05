<div align="center">

# Better T3 Code

**T3 Code, plus the power-user buttons someone was inevitably going to add.**

An independent, batteries-included fork of [T3 Code](https://github.com/pingdotgg/t3code)
for people who looked at one coding agent and thought, “Great. Can it have coworkers?”

[What is better?](#yeah-but-what-does-this-thing-actually-do-better-than-t3-code) ·
[Run the fork](#run-the-fork) · [Documentation](#documentation) ·
[Upstream](https://github.com/pingdotgg/t3code)

</div>

Better T3 Code keeps the fast, open, remote-ready T3 Code core: bring your own Codex, Claude Code,
Cursor, Grok Build, or OpenCode subscription and control it from the web, desktop, or mobile clients.
This fork adds the opinionated workflows around that core—the things that usually begin with,
“Okay, but could it also…?”

> [!IMPORTANT]
> `npx t3@latest`, [app.t3.codes](https://app.t3.codes), the official mobile apps, and the
> [upstream releases](https://github.com/pingdotgg/t3code/releases) are stock T3 Code. Run or build
> this repository to use the fork-only features below.

## “Yeah, but what does this thing actually do better than T3 Code?”

Excellent question, suspiciously direct stranger. The short version: Better T3 Code gives agents
coworkers, makes those coworkers visible, adds safer escape hatches, and includes substantially more
power-user plumbing around the chat.

| Workflow                   | T3 Code                                                     | Better T3 Code                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Repository exploration** | A normal provider turn explores the project                 | **Fetch** can start exactly three read-only native subagents with separate discovery scopes before the first edit                                |
| **Plan implementation**    | Implement a proposed plan normally                          | Review a plan with a fast model, choose a useful agent count, and implement it with provider-native subagents in parallel                        |
| **Subagent visibility**    | Provider activity stays in the main conversation            | Live lifecycle pills, persistent agent history, and readable per-agent transcript dialogs                                                        |
| **Stopping runaway work**  | Standard cooperative stop                                   | Cooperative stop, second-click force stop, and automatic exact-runtime termination after roughly five seconds—without throwing away chat history |
| **Switching providers**    | A started thread remains bound to compatible provider state | Switch provider or model mid-thread with a complete transcript handoff when native resume is not compatible                                      |
| **Voice input**            | No built-in streaming dictation workflow                    | AssemblyAI dictation with a live waveform, project terminology indexing, and optional English output                                             |
| **Chat portability**       | Normal in-app thread history                                | Copy the complete unredacted transcript and import chats from sibling local T3 Code installations                                                |
| **Agent tooling**          | Provider-managed configuration                              | Visual MCP server management plus global/project skill discovery, import, enablement, and prompt integration                                     |
| **Prompt ergonomics**      | Standard prompt and reasoning controls                      | Optional prompt improvement and evidence-based, one-turn reasoning-effort recommendations                                                        |
| **Repository context**     | Providers use their regular filesystem tools                | A bounded `workspace_context` MCP tool batches common project discovery and file-reading work                                                    |
| **Project organization**   | One active-project list                                     | Quiet projects move into a collapsible **Older projects** section after seven days                                                               |
| **Product analytics**      | Anonymous PostHog product analytics                         | Outbound anonymous product analytics removed; local resource diagnostics stay local and useful                                                   |

> [!NOTE]
> **Fetch** and **Parallel plan implementation** are experimental, off by default, and currently
> available in the web and desktop clients. They only activate when the selected provider advertises
> the required native-subagent support. Experimental means “useful enough to keep” and “spicy enough
> to deserve a switch.”

For the precise behavior of Fetch, parallel implementation, force stop, and temporary reasoning
overrides, see [Chat controls](./docs/user/chat-controls.md).

## The upstream good stuff is still here

- Use existing subscriptions for Codex, Claude Code, Cursor, Grok Build, and OpenCode.
- Work from the web, the Electron desktop client, or the iOS and Android mobile clients.
- Connect locally, across a LAN or tailnet, or through T3 Connect.
- Keep durable threads, project state, provider sessions, and git checkpoints.
- Stay open source. If this fork becomes unbearably sensible, you can fork the fork. Nature heals.

## Run the fork

### Prerequisites

- Node.js `24.13.1` or a newer compatible Node 24 release
- [Vite+ (`vp`)](https://viteplus.dev/guide/)
- At least one installed and authenticated provider:
  [Codex](https://developers.openai.com/codex/cli),
  [Claude Code](https://claude.com/product/claude-code),
  [Cursor](https://cursor.com/cli),
  [Grok Build](https://x.ai/cli), or
  [OpenCode](https://opencode.ai)

Install Vite+ on macOS or Linux:

```bash
curl -fsSL https://vite.plus | bash
```

On Windows PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

### Start the web app and server

```bash
git clone https://github.com/AlexanderDotH/better-t3code.git
cd better-t3code
vp i
vp run dev
```

The dev runner prints the real local URL and a one-time pairing URL. Open the pairing URL—the bare
origin is just a very pretty locked door.

### Build a desktop artifact

```bash
# Linux AppImage
vp run dist:desktop:linux

# macOS DMG
vp run dist:desktop:dmg

# Windows installer
vp run dist:desktop:win
```

Want stock T3 Code instead? This is the intentionally boring command:

```bash
npx t3@latest
```

## Documentation

- [Documentation map](./docs/README.md)
- [Quick start](./docs/getting-started/quick-start.md)
- [Chat controls and experimental workflows](./docs/user/chat-controls.md)
- [Git workbench](./docs/user/git-workbench.md)
- [MCP servers and provider-specific status](./docs/user/mcp-servers.md)
- [Remote access](./docs/user/remote-access.md)
- [Keybindings](./docs/user/keybindings.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Internal MCP architecture](./docs/architecture/internal-mcp.md)
- [Provider guides](./docs/providers/codex.md)
- [Reference encyclopedia](./docs/reference/encyclopedia.md)

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request. The project is MIT
licensed and remains deeply indebted to the excellent work in
[upstream T3 Code](https://github.com/pingdotgg/t3code).

Small fixes are welcome. Big ideas are welcome too, but may be asked to explain themselves to the
performance budget.
