import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const webShellInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "webShell.splash.accessibilityLabel": [
    "T3 Code splash screen",
    "T3-Code-Startbildschirm",
    "Écran de démarrage de T3 Code",
  ],
  "webShell.thread.current": ["Current thread", "Aktueller Chat", "Discussion actuelle"],
  "webShell.thread.noActive": ["No active thread", "Kein aktiver Chat", "Aucune discussion active"],
  "webShell.thread.pickToContinue": [
    "Pick a thread to continue",
    "Chat auswählen, um fortzufahren",
    "Sélectionnez une discussion pour continuer",
  ],
  "webShell.thread.selectOrCreate": [
    "Select an existing thread or create a new one to get started.",
    "Einen vorhandenen Chat auswählen oder einen neuen erstellen.",
    "Sélectionnez une discussion existante ou créez-en une nouvelle pour commencer.",
  ],
});

export type WebShellInterfaceMessageKey = (typeof webShellInterfaceCatalog.keys)[number];
