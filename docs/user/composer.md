# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

The first message in a fork uses the same character and attachment limits as any other message.
T3 Code fits the newest inherited context into the remaining provider capacity without removing
anything from the visible forked timeline.

On mobile with an external keyboard, press `Cmd+Enter` or `Ctrl+Enter` to send. Plain Enter and
Shift+Enter remain available for new lines. The Android editor uses the selected mobile text size
and the same app font as the rest of the composer.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.

On web and desktop, Chat stays between the upper and lower edges of the workspace card deck.
Selecting an edge smoothly reshapes that card into the foreground while the other cards reorder
behind it and reveal only at their new outer edge. You can select the next edge before the current
motion finishes; the newest selection continues from the visible size and softly faded content. The
upper and lower edges remain present throughout the bounce, without opening a blank seam. Floating
decision panels use their own short surface motion, while typing, attachments, and context updates
keep the composer and chat layout still. Reduced Motion switches every surface immediately instead.
