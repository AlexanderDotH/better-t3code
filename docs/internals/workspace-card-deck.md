# Workspace card deck architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

The workspace card deck is the web-and-desktop client primitive that places persistent tools at the
bottom of a chat without turning the composer into a tab bar. It owns card ordering, exposed-edge
navigation, compact sizing, accessibility, and surface motion. Individual cards own their content
and runtime state. Mobile bypasses the deck, and the feature adds no server contract or desktop IPC.

## Descriptor model

`WorkspaceCardDeck` receives an ordered array of typed card descriptors. Each descriptor has a
stable ID and label plus separate body and peek renderers. The chat adapter registers Chat, Git when
available, and MCP in that order. This local array is the extension point; there is no global
registry or mobile card abstraction.

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

## Sizing and resting layout

Each card marks its natural compact content and visual surface inside an intrinsic wrapper.
`ResizeObserver` follows Chat's natural composer content while every visual shell stretches to that
reference height, avoiding a measurement feedback loop and preventing asynchronous card content
from moving click targets. Measurements are batched to animation frames. Until Chat is first
measured, the deck uses the active card's natural height instead of flashing at zero height.

The resting geometry is an invariant, not an animation state: the active card stays in the middle,
the previous peek is 32 px above it, and the next peek is 32 px below it. Both peeks remain inset
22 px from the active surface. The upper peek has `16px 16px 0 0` corners, the lower peek has
`0 0 16px 16px` corners, and a full compact surface has 22 px corners. The peek layer stays behind
the active viewport. A reordered back shell is never translated across the translucent foreground;
it stays at its new outer edge, remains visually concealed during the reorder, and reveals there.

Expanded content is excluded from compact measurements, but the mounted Chat composer remains
observed while another card is expanded. The compact height is frozen during a shuffle and
reconciled afterward, including composer growth. Non-Chat content must prioritize and truncate its
compact presentation inside the Chat-sized shell instead of contributing a competing height.
Compact Git and MCP never add an inner scrollbar; detailed content belongs in expanded surfaces.
Genuine compact-height changes use a 200 ms ease-out transition.

Expanded non-Chat content is the explicit sizing exception. Git and MCP use the generic
`WorkspaceCardDrawerShell`, default to about 62% of the chat column, resize vertically, preserve at
least the available timeline space, and cap at 80%. Their device-local heights use separate storage
keys. Opening either drawer temporarily hides the terminal drawer without destroying its session or
remembered height, and the independent right-side file/diff panel remains untouched.

## Surface morph system

The internal surface morph coordinator is shared by the deck and composer drawers on web and
desktop. It records source geometry before a state change and destination geometry in the following
layout phase. Geometry includes the border box, four independent corner radii, origin, background
color, border, and shadow. The coordinator produces short-lived WAAPI/FLIP motion; React does not
rerender on animation frames.

The real surface content translates and scales between those rectangles and remains clipped to the
moving contour. It stays visible throughout the morph, with only a subtle fade toward 84% while it
is compressed into a peek and back to full opacity while it expands. A separate chrome proxy draws
the glass, 1 px border, corners, and shadow, so non-uniform scaling cannot visibly thicken the border. Proxies
interpolate `background-color` rather than the full CSS background shorthand so glass color cannot
step between layered values. Deck proxies remain absolutely positioned inside their owning card's
morph host and use host-local coordinates; they are never viewport-fixed children of transformed
layout. Their geometry and appearance keyframes share the exact same phase offsets and easing as the
real content. Because the content is scaled non-uniformly, its four corner radii use sampled
horizontal/vertical compensation along that same curve; the visible clip therefore continues to
match the unscaled glass radius instead of flattening vertically. Proxies are transient,
`aria-hidden`, inert, and pointerless. They are removed together with temporary inline styles on
finish or cancellation.

For a card switch, the selected upper or lower peek expands to the 22 px foreground surface while
the old active surface contracts to the opposite 16 px directional peek. Both motions use 560 ms,
a fast spring-like curve, and at most 3 px overshoot. The remaining shell moves behind the clipped
foreground ordering and is already placed in the newly free peek position. It begins at 72% opacity,
tucks at most 3 px underneath the foreground seam instead of moving outside the deck, and settles to
full opacity over the complete morph. The destination edge therefore never becomes an empty gap and
its hit target remains available throughout. The whole active card body participates, so controls
and text keep the compressed morph while the small opacity change softens it.

Compact-to-expanded Git and MCP changes use the same captured border boxes. When switching away
from an expanded card, the existing height collapse finishes first and the compact destination is
recaptured before the deck morph starts. This keeps persisted state and focus ownership separate
from visual motion.

The outer composer group never participates in ordinary surface morphs. Attachments, context, and
preview content use normal layout, so their updates cannot translate or scale the deck or chat.
Hero-to-dock is the only outer-group exception: it uses a separate 180 ms translation-only handoff
when the hero state actually changes. Explicit command, stash, and task drawers morph from their
trigger for 420 ms and exit in 360 ms.

Automatic approval, question, plan, sync, banner, and error surfaces remain real immediately for
state and accessibility, while their floating chrome enters as a droplet:

- At 0–22%, a narrow glass neck grows from the nearest composer seam.
- At 22–68%, the droplet rises and expands toward its final panel rectangle.
- At 68–84%, the neck retracts and detaches while the panel overshoots by at most 6 px or 1.5%.
- At 84–100%, the panel settles into the existing 16 px floating-island geometry and gap.

Explicit drawers use the paired trigger as their origin; automatically inserted surfaces use the
nearest composer edge. The neck is decorative and never becomes an interactive or accessible
element. Action-required promotion to Chat remains immediate even when the newly visible floating
surface plays its entry motion.

## Cancellation, accessibility, and fallback

There is one composer drawer morph at a time. A newer user action wins: the coordinator captures
the currently rendered geometry, cancels the old animations, removes their proxies, and starts from
that visible state rather than queueing work. Resize, route or scope changes, document visibility,
and component teardown settle on the authoritative React layout and perform the same cleanup.

An ordinary compact deck selection can cancel and restart an in-flight morph from its current
visible surface geometry, visible content box, color, and opacity. Peek hit targets remain enabled
during ordinary motion, so rapid selections replace the current morph without resetting the
compressed content to its natural height. The lock while an expanded panel collapses is the
exception: the destination is recorded, further selection remains locked, and the card morph starts
only after compact geometry is available. Automatic action drawers do not delay their state,
live-region content, or focus contract for decorative motion. Hidden card bodies remain inert, and
focus is restored to the remembered destination only after an ordinary deck transition completes.

`prefers-reduced-motion: reduce` bypasses scale, overshoot, droplet, and height animation and commits
the final layout immediately. Environments without `Element.animate` use the existing clipped CSS
carousel fallback for deck switching; composer drawers settle immediately. Animation
failure is never allowed to block state progression or leave a proxy mounted.

Only active motion receives `will-change`. At most the incoming and outgoing card chrome proxies
plus one droplet neck exist simultaneously. Geometry is measured only at state boundaries, and
continuous blur, idle repaint loops, and frame-driven React state are prohibited.

## Ownership boundaries

`ChatWorkspaceDeckController` composes the descriptor array and owns chat-scoped selection. Its
`ChatWorkspaceDeck` policy adapter blocks departures during recording, closes portaled composer UI
before Chat becomes inert, remembers composer focus, restores it on return, sequences
expanded-panel collapse before ordinary selection, and promotes Chat for action-required events.

`WorkspaceCardDeck` owns deck geometry, transition roles, surface capture, proxy cleanup, and the
CSS fallback. The shared surface morph coordinator owns geometry/keyframe calculation and animation
lifecycle, but it does not own product state or selection policy. The floating-island integration
owns droplet origins and decorative neck rendering; individual drawers remain responsible for their
content, focus semantics, and trigger association.

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
