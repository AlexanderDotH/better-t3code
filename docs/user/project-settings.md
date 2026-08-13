# Project settings

Open **Settings**, select **Projects**, then select **Configure** for a project. Settings apply to
each checkout in the selected project group. You can also open the project switcher in the main
sidebar and select the settings button next to a project.

## Checkpoints

T3 Code creates hidden Git checkpoints before and after agent turns. They power turn diffs and
restore actions, but can add noticeable overhead in very large repositories.

Turn off **Create checkpoints** for projects where that overhead is a problem. New turns stop
creating checkpoint refs and provider diff placeholders; existing checkpoints are kept and can
still be restored. Turn processing and Git status updates continue normally.

Each checkout stores this setting on its own environment. Changing a normalized project group
updates every checkout in the group. T3 Code attempts the update on all connected environments even
if one fails, then identifies every environment that needs attention.

If grouped checkouts disagree, the control shows **Mixed**. In that state, each checkout continues
using its own saved value: enabled checkouts create checkpoints and disabled checkouts do not. Use
**Enable all** or **Disable all** to normalize the group. These actions are serialized, so a second
click cannot overlap an update that is still in progress; after a partial failure, retry the desired
action once the unavailable environment is reachable.

## Project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To choose a different icon:

1. Select **Choose file** next to **Project icon**.
2. Search for an image file and select it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.
