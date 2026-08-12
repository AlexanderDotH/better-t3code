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

## Project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To choose a different icon:

1. Select **Choose file** next to **Project icon**.
2. Search for an image file and select it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.
