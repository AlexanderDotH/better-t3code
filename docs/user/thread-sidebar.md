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

## Recent and older projects

Both sidebar layouts use the same activity rule for **Older projects**. A project remains in the
recent area through exactly seven days without work and moves to **Older projects** only after that
boundary. Starting work in the project or one of its threads moves it back to the recent area
immediately. Work that still needs attention, such as a running session or a pending approval, also
keeps the project recent.

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
