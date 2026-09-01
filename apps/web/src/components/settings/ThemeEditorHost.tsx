import { useCallback } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useTheme } from "../../hooks/useTheme";
import { getThemeDefinition, type ThemeAppearance, type ThemeDefinition } from "../../themePalette";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ThemeEditorPanel } from "./ThemeEditorPanel";
import { useThemeEditorStore } from "./themeEditorStore";

/**
 * Renders the theme editor above the router. The editor paints its draft on
 * the live app, so it has to outlive the settings route: the point is to walk
 * through threads, panels, and pages while the colors are being tuned.
 */
export function ThemeEditorHost() {
  const translate = useInterfaceTranslator().message;
  const session = useThemeEditorStore((store) => store.session);
  const closeThemeEditor = useThemeEditorStore((store) => store.closeThemeEditor);
  const { theme, setTheme, themeHalves, refreshTheme } = useTheme();

  // The panel reports which path it actually took: a theme removed while its
  // editor is open resolves to null there, so the save becomes a create even
  // though the session still names it.
  const handleSaved = useCallback(
    (
      savedTheme: ThemeDefinition,
      { created, mergedAppearance }: { created: boolean; mergedAppearance?: ThemeAppearance },
    ) => {
      // A merge completed an existing theme's light/dark pair; activating the
      // whole theme shows the new palette right away.
      if (mergedAppearance) {
        if (!setTheme(savedTheme.id)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.theme.toast.saveFailed"),
              description: translate("settings.theme.toast.storageUnavailable"),
            }),
          );
          return false;
        }
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: translate("settings.theme.toast.updated", { theme: savedTheme.label }),
            description: translate("settings.theme.toast.paletteAdded", {
              appearance: translate(
                mergedAppearance === "light"
                  ? "settings.theme.editor.light"
                  : "settings.theme.editor.dark",
              ),
            }),
          }),
        );
        return true;
      }
      if (!created) {
        // The edited theme may be showing through the base preference or either
        // half of the mix; the preference itself is untouched (a setTheme here
        // would clear the mix), the palette just needs re-applying.
        const wasActive =
          getThemeDefinition(theme)?.id === savedTheme.id ||
          themeHalves?.light === savedTheme.id ||
          themeHalves?.dark === savedTheme.id;
        if (wasActive) refreshTheme();
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: translate("settings.theme.toast.saved", { theme: savedTheme.label }),
            description: translate(
              wasActive
                ? "settings.theme.toast.changesActive"
                : "settings.theme.toast.changesSaved",
            ),
          }),
        );
        return true;
      }

      if (!setTheme(savedTheme.id)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translate("settings.theme.toast.saveFailed"),
            description: translate("settings.theme.toast.storageUnavailable"),
          }),
        );
        return false;
      }
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: translate("settings.theme.toast.created", { theme: savedTheme.label }),
          description: translate("settings.theme.toast.nowActive"),
        }),
      );
      return true;
    },
    [refreshTheme, setTheme, theme, themeHalves, translate],
  );

  if (!session) return null;

  // Resolve on every render: an edit or import can change the stored
  // definitions while a session is open.
  const editingTheme = session.editingThemeId
    ? (getThemeDefinition(session.editingThemeId) ?? null)
    : null;
  const seedTheme = session.seedThemeId ? (getThemeDefinition(session.seedThemeId) ?? null) : null;

  return (
    <ThemeEditorPanel
      editingTheme={editingTheme}
      initialAppearance={session.initialAppearance}
      key={session.id}
      onOpenChange={(open) => {
        if (!open) closeThemeEditor();
      }}
      onSaved={handleSaved}
      open
      restoreTheme={refreshTheme}
      seedName={session.seedName ?? undefined}
      seedTheme={seedTheme}
    />
  );
}
