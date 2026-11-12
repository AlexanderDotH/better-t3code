import type { Preferences } from "../../persistence/mobile-preferences";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import * as Dialog from "../../components/ui/Dialog";

export type ConfirmableThreadAction = "unpin" | "archive" | "delete";

export function shouldConfirmThreadAction(
  action: ConfirmableThreadAction,
  preferences: Preferences,
) {
  switch (action) {
    case "unpin":
      return preferences.confirmThreadUnpin ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.confirmThreadUnpin;
    case "archive":
      return (
        preferences.confirmThreadArchive ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.confirmThreadArchive
      );
    case "delete":
      return (
        preferences.confirmThreadDelete ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.confirmThreadDelete
      );
  }
}

export function confirmThreadAction(
  action: ConfirmableThreadAction,
  count: number,
): Promise<boolean> {
  const translator = currentInterfaceTranslator();
  return new Promise((resolve) =>
    Dialog.confirm({
      title: translator.message(
        count === 1 ? `mobile.home.confirm.${action}.one` : `mobile.home.confirm.${action}`,
        { count },
      ),
      ...(action === "delete"
        ? { message: translator.message("sidebar.thread.deleteManyHistoryWarning") }
        : {}),
      confirmText: translator.message(
        action === "delete"
          ? "mobile.thread.delete"
          : action === "archive"
            ? "mobile.thread.archive"
            : "mobile.thread.unpin",
      ),
      destructive: action === "delete",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    }),
  );
}
