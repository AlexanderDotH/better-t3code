import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for timeline parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityTimelineInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.timeline.editMessage": ["Edit message", "Nachricht bearbeiten", "Modifier le message"],
  "mobile.timeline.messageActions": [
    "Message actions",
    "Nachrichtenaktionen",
    "Actions du message",
  ],
  "mobile.timeline.editFailed": [
    "Could not save the message.",
    "Die Nachricht konnte nicht gespeichert werden.",
    "Impossible d’enregistrer le message.",
  ],
  "mobile.timeline.editUnavailable": [
    "Stop the current turn and reconnect before editing.",
    "Stoppe den aktuellen Durchlauf und stelle die Verbindung wieder her.",
    "Arrêtez le tour en cours et reconnectez-vous avant de modifier.",
  ],
  "mobile.timeline.cancel": ["Cancel", "Abbrechen", "Annuler"],
  "mobile.timeline.save": ["Save", "Speichern", "Enregistrer"],
  "mobile.timeline.saving": ["Saving…", "Wird gespeichert…", "Enregistrement…"],
  "mobile.timeline.editFromHere": [
    "Edit from here",
    "Ab hier bearbeiten",
    "Modifier à partir d’ici",
  ],
  "mobile.timeline.rewindConfirm": [
    "Remove this message and the turns after it, and restore it to your draft? You can also restore workspace files to this checkpoint.",
    "Diese Nachricht und die folgenden Durchläufe entfernen und sie im Entwurf wiederherstellen? Du kannst auch die Arbeitsdateien auf diesen Checkpoint zurücksetzen.",
    "Supprimer ce message et les tours suivants, puis le remettre dans le brouillon ? Vous pouvez aussi restaurer les fichiers à ce point de contrôle.",
  ],
  "mobile.timeline.rewindConversation": [
    "Conversation only",
    "Nur Unterhaltung",
    "Conversation uniquement",
  ],
  "mobile.timeline.rewindFiles": [
    "Also restore files",
    "Auch Dateien wiederherstellen",
    "Restaurer aussi les fichiers",
  ],
  "mobile.timeline.rewindFailed": [
    "Could not rewind",
    "Zurücksetzen fehlgeschlagen",
    "Retour en arrière impossible",
  ],
  "mobile.timeline.rewindTimeout": [
    "The rewind has not finished. Check the thread before trying again.",
    "Das Zurücksetzen ist noch nicht abgeschlossen. Prüfe den Chat, bevor du es erneut versuchst.",
    "Le retour en arrière n’est pas terminé. Vérifiez la discussion avant de réessayer.",
  ],
  "mobile.timeline.attachmentUnavailable": [
    "An attachment could not be restored. Reconnect and try again.",
    "Ein Anhang konnte nicht wiederhergestellt werden. Verbinde dich erneut und versuche es noch einmal.",
    "Une pièce jointe n’a pas pu être restaurée. Reconnectez-vous et réessayez.",
  ],
  "mobile.timeline.attachmentCapacity": [
    "Make room for this message’s attachments in the draft first.",
    "Schaffe zuerst Platz für die Anhänge dieser Nachricht im Entwurf.",
    "Libérez d’abord de la place pour les pièces jointes de ce message dans le brouillon.",
  ],
  "mobile.timeline.find": ["Find in thread", "Im Chat suchen", "Rechercher dans la discussion"],
  "mobile.timeline.findPlaceholder": ["Find text…", "Text suchen…", "Rechercher du texte…"],
  "mobile.timeline.findCount": [
    "{{current}} of {{count}}",
    "{{current}} von {{count}}",
    "{{current}} sur {{count}}",
  ],
  "mobile.timeline.findPrevious": ["Previous match", "Vorheriger Treffer", "Résultat précédent"],
  "mobile.timeline.findNext": ["Next match", "Nächster Treffer", "Résultat suivant"],
  "mobile.timeline.closeFind": ["Close search", "Suche schließen", "Fermer la recherche"],
  "mobile.timeline.loadHistory": [
    "Search earlier history",
    "Frühere Nachrichten durchsuchen",
    "Rechercher dans l’historique précédent",
  ],
  "mobile.timeline.tasks": ["Agent tasks", "Agent-Aufgaben", "Tâches de l’agent"],
  "mobile.timeline.taskProgress": [
    "{{done}} of {{total}} tasks",
    "{{done}} von {{total}} Aufgaben",
    "{{done}} tâches sur {{total}}",
  ],
  "mobile.timeline.quote": ["Quote in reply", "In Antwort zitieren", "Citer dans la réponse"],
  "mobile.timeline.comment": ["Comment", "Kommentieren", "Commenter"],
  "mobile.timeline.commentPlaceholder": [
    "Comment on this quote…",
    "Dieses Zitat kommentieren…",
    "Commenter cette citation…",
  ],
  "mobile.timeline.insertQuote": ["Insert quote", "Zitat einfügen", "Insérer la citation"],
  "mobile.timeline.quoteUnavailable": [
    "This selection could not be quoted. Try a shorter passage.",
    "Diese Auswahl konnte nicht zitiert werden. Versuche es mit einem kürzeren Abschnitt.",
    "Impossible de citer cette sélection. Essayez un passage plus court.",
  ],
  "mobile.timeline.expandTable": ["Expand table", "Tabelle vergrößern", "Agrandir le tableau"],
  "mobile.timeline.copyMarkdown": [
    "Copy as Markdown",
    "Als Markdown kopieren",
    "Copier en Markdown",
  ],
  "mobile.timeline.copyCsv": ["Copy as CSV", "Als CSV kopieren", "Copier en CSV"],
  "mobile.timeline.close": ["Close", "Schließen", "Fermer"],
  "mobile.timeline.runTerminal": [
    "Run in terminal",
    "Im Terminal ausführen",
    "Exécuter dans le terminal",
  ],
  "mobile.timeline.replies": [
    { one: "{{count}} reply", other: "{{count}} replies" },
    { one: "{{count}} Antwort", other: "{{count}} Antworten" },
    { one: "{{count}} réponse", other: "{{count}} réponses" },
  ],
  "mobile.timeline.stop": ["Stop", "Stoppen", "Arrêter"],
  "mobile.timeline.retry": ["Retry", "Erneut versuchen", "Réessayer"],
  "mobile.timeline.pending": ["Pending", "Ausstehend", "En attente"],
  "mobile.timeline.running": ["Running", "Läuft", "En cours"],
  "mobile.timeline.waiting": ["Waiting for input", "Wartet auf Eingabe", "Attend une réponse"],
  "mobile.timeline.completed": ["Completed", "Abgeschlossen", "Terminé"],
  "mobile.timeline.interrupted": ["Stopped", "Gestoppt", "Arrêté"],
  "mobile.timeline.failed": ["Failed", "Fehlgeschlagen", "Échec"],
  "mobile.timeline.linkPr": ["Link to thread", "Mit Chat verknüpfen", "Lier à la discussion"],
  "mobile.timeline.unlinkPr": [
    "Unlink from thread",
    "Vom Chat lösen",
    "Dissocier de la discussion",
  ],
  "mobile.timeline.jumpList": ["Jump to message", "Zu Nachricht springen", "Aller au message"],
  "mobile.timeline.openDiff": ["Open file diff", "Datei-Diff öffnen", "Ouvrir le diff du fichier"],
  "mobile.timeline.explainMetric": [
    "Explain {{metric}}",
    "{{metric}} erklären",
    "Expliquer {{metric}}",
  ],
});

export type MobileParityTimelineInterfaceMessageKey =
  (typeof mobileParityTimelineInterfaceCatalog.keys)[number];
