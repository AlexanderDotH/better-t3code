# Workspace card deck architecture

The workspace card deck is the web-and-desktop client primitive that places several persistent
tools at the bottom of a chat without turning the composer into a tab bar. It owns card ordering,
exposed-edge navigation, compact sizing, accessibility, and vertical motion. Individual cards own
their content and runtime state.

## Descriptor model

`WorkspaceCardDeck` receives an ordered array of typed card descriptors. Each descriptor has a
stable ID and label plus separate body and peek renderers. The chat adapter registers Chat, Git when
available, and MCP in that order. This local array is the extension point; there is no global
registry, server contract, desktop IPC, or mobile card abstraction.

The active card, previous card, and next card are derived circularly from descriptor order. With two
cards, only one destination peek is rendered and it alternates sides after each switch. Removing the
active descriptor invalidates the remembered selection and promotes Chat immediately. A remembered
prototype ID such as `example` is invalid and falls back to Chat without animation.

Every registered body stays mounted. Only the active section is interactive and exposed to
accessibility APIs; inactive sections are inert, `aria-hidden`, and pointer-disabled. Peeks are
sibling controls outside those inert sections. This preserves Chat drafts, attachments, provider
state, and focus without making hidden controls reachable.

Selection is session-local and scoped by environment, effective worktree, and thread. New threads
start on Chat. Scope changes cancel motion, clear transient measurements, collapse any expanded
card, and restore only a still-valid remembered selection.

## Sizing and layout

Each card marks its natural compact content and visual surface inside an intrinsic wrapper.
`ResizeObserver` follows Chat's natural composer content while every visual shell stretches to that
reference height, avoiding a measurement feedback loop and preventing asynchronous card content
from moving the click targets. Measurements are batched to animation frames. Until Chat is first
measured, the deck uses the active card's natural height instead of flashing at zero height.

Expanded content is excluded from compact measurements, but the mounted Chat composer remains
observed while another card is expanded. The compact height is frozen during a shuffle and
reconciled afterward, including composer growth. Non-Chat content must prioritize and truncate its
compact presentation inside the Chat-sized shell instead of contributing a competing height.
Compact Git and MCP never add an inner scrollbar; detailed content belongs in their expanded
surfaces. Genuine compact-height changes use a 200 ms ease-out transition. Each exposed edge is
32 px high and inset 22 px from either side of the active card.

Expanded non-Chat content is the explicit sizing exception. Git and MCP use the generic
`WorkspaceCardDrawerShell`, default to about 62% of the chat column, resize vertically, preserve at
least the available timeline space, and cap at 80%. Their device-local heights use separate storage
keys. Opening either drawer temporarily hides the terminal drawer without destroying its session or
remembered height, and the independent right-side file/diff panel remains untouched. Mobile
bypasses the deck.

## Interaction and motion

Only the previous or next peek requests selection. Foreground bodies never use their background as
a navigation target. MCP's exposed edge is one real accessible button. Git retains mixed
interaction: its free-area activation layer and enabled environment, worktree, branch, and
pull-request controls are siblings with explicit stacking, never nested interactive elements.

A normal request is ignored while another shuffle is active. Policy events such as an approval or
question cancel it, close nested card UI, collapse the active card, and promote Chat immediately.
Voice recording prevents leaving Chat. Selecting a neighboring peek while any non-Chat card is
expanded records the requested destination and locks further selection. The active panel first
completes its height transition back to the Chat reference; only its `height` transition end, or a
bounded fallback, starts the card shuffle. Reduced motion completes both state changes without
transforms.

The foreground content fades for 90 ms, vertical card movement starts after 90 ms and lasts 600 ms,
and incoming content fades in for 300 ms beginning 350 ms into the shuffle. Card backgrounds,
borders, and blur never fade. Only participating cards receive transient `will-change`. Animation
end or cancellation completes the transition, with a 750 ms defensive fallback. Reduced-motion
mode changes roles and heights immediately.

## Ownership boundaries

`ChatWorkspaceDeckController` composes the descriptor array and owns chat-scoped selection. Its
`ChatWorkspaceDeck` policy adapter blocks departures during recording, closes portaled composer UI
before Chat becomes inert, remembers composer focus, restores it on return, sequences
expanded-panel collapse before ordinary selection, and promotes Chat for action-required events.

`GitWorkspaceCardController` remains the only Git runtime for an active chat. It owns status,
expansion, dialogs, mutations, and lazy workbench data while rendering through the generic
descriptor. `McpWorkspaceCardController` owns one MCP card projection and consumes the same shared
configuration and runtime projections as MCP Settings. Neither controller owns the other's runtime
or subscription graph.

Detailed Git subscriptions exist only while Git is active or expanded. MCP provider-context lists
exist only while MCP is active or expanded, while its compact exact-runtime subscription remains
available for truthful peek statistics. Capability negotiation prevents an old server from
receiving new MCP runtime requests.

Global type-anywhere composer focus is disabled whenever Chat is not active. Escape closes a nested
dialog first and then collapses the active non-Chat card; it does not rotate the deck.
