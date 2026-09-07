# Interface language

T3 Code is available in English, German, and French across web, desktop, and mobile.

On web and desktop, open **Settings > Better T3 > General > Language**. On mobile, open **Settings > Appearance > Language**. Then choose:

- **System** to follow the preferred language of each device.
- **English** to always use the English interface.
- **Deutsch** to always use the German interface.
- **Français** to always use the French interface.

An explicit language choice uses `en-US`, `de-DE`, or `fr-FR` formatting. With **System**, T3 Code
preserves `de-DE`, `de-AT`, `de-CH`, and `fr-FR` for regional number, date, plural, and list
formatting. Other supported English system locales keep their regional formatting. Unsupported or
invalid system locales fall back to English with `en-US` formatting.

## What changes

The setting translates copy owned by T3 Code, including navigation, settings, chat controls,
dialogs, errors, empty states, notifications, accessibility labels, and native desktop and mobile
surfaces.

The following content stays exactly as it was received:

- your prompts and other text you enter;
- provider and agent responses;
- repository files, paths, branch names, commit messages, and documentation;
- code, terminal output, logs, commands, flags, URLs, and machine-readable values.

T3 Code can place those values inside a translated explanation, but it does not translate or
rewrite the values themselves.

## Synchronization

Your selection takes effect immediately and remains available offline. T3 Code synchronizes it
with compatible connected environments and retries deferred updates after reconnecting. If you
choose **System**, the preference synchronizes while every device still resolves its own system
locale.

Current environments support English, German, and French. Older compatible environments support
the earlier English and German setting. T3 Code does not send French to an environment that cannot
represent it; the Language row identifies environments that need an update or failed to receive the
selection.

When different devices change the language while disconnected, the newest saved choice wins after
they reconnect.
