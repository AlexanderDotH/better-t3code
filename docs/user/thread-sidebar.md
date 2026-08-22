# Organizing threads

## Choose a sidebar layout

On web and desktop, open **Settings → Appearance → Sidebar layout** and choose one of the
following layouts:

- **Current** shows activity-oriented lists. Active work uses rich cards, while settled threads use
  compact rows.
- **Classic** shows the original project-first tree, with threads nested below each project.

Changing the layout only changes how your existing projects and threads are presented. T3 Code
stores the choice in your settings and restores it after a reload or restart. **Current** remains the
default when no choice has been saved.

On mobile, the equivalent **Settings → Appearance → Thread list layout** choice is stored on that
device, so its layout can differ from web and desktop.

## Limit chats shown per project

The **Classic** layout initially shows up to three chats in each project. Choose **Chats per
project** in **Settings → Appearance** to set any value from 1 through 15. Web and desktop also
offer the same control from the Classic sidebar menu. Use **Show more** to reveal the rest of a
project's non-settled chats. After those chats are visible, use **Show settled chats** to append the
settled chats or **Hide settled chats** to conceal them again. If all non-settled chats already fit,
**Show settled chats** appears immediately. **Show less** returns to the configured limit and hides
the settled section. Searching continues to show every matching chat, regardless of the limit.
Chats labeled **Working** or **Connecting** stay visible in addition to the configured number, so
active work is never hidden behind **Show more**.

The project-grouped Home list and tablet sidebar on mobile use the same ordering and controls.
Settled chats do not count toward the per-project preview limit. The **Current** activity-based
layout keeps its separate settled section and is not affected by these project controls.

This preference is shared through every connected environment that supports synchronized
appearance settings, while each device keeps an offline copy for immediate use. Changes made
offline are retried when an environment reconnects. If Settings identifies an environment that
needs an update, that environment is skipped until its T3 Code server is updated; the remaining
compatible environments still synchronize normally.

The first upgrade changes the former six-chat value to the new default of three when no
synchronized choice exists. Other saved values are preserved, and choosing six afterward remains
a normal preference.

## Recent and older projects

Both sidebar layouts use the same activity rule for **Older projects**. A project remains in the
recent area through exactly seven days without work and moves to **Older projects** only after that
boundary. Starting work in the project or one of its threads moves it back to the recent area
immediately. Work that still needs attention, such as a running session or a pending approval, also
keeps the project recent. Mobile's project-grouped thread list uses the same boundary and stores the
Older projects disclosure state on that device.

## Pin and arrange threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
