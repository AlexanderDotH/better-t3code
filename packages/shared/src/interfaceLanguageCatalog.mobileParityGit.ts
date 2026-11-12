import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for git parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityGitInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.gitParity.deletedFile": [
    "The file was deleted while you were editing. Your edits are preserved here; copy them before closing.",
    "Die Datei wurde während der Bearbeitung gelöscht. Deine Änderungen bleiben hier erhalten; kopiere sie vor dem Schließen.",
    "Le fichier a été supprimé pendant la modification. Vos modifications sont conservées ici ; copiez-les avant de fermer.",
  ],
  "mobile.gitParity.deletedConflict": [
    "The working file is deleted. Mark resolved to keep the deletion.",
    "Die Arbeitsdatei ist gelöscht. Markiere den Konflikt als gelöst, um die Löschung beizubehalten.",
    "Le fichier de travail est supprimé. Marquez le conflit comme résolu pour conserver cette suppression.",
  ],
  "mobile.gitParity.queueThreadDescription": [
    "Choose a conversation for this checkout. The workflow waits for its active turn, or runs now if it is idle.",
    "Wähle eine Unterhaltung für diesen Checkout. Der Workflow wartet auf den aktiven Durchlauf oder startet sofort, wenn keiner läuft.",
    "Choisissez une conversation pour cette copie du dépôt. Le flux attend son tour actif ou démarre immédiatement si elle est inactive.",
  ],
  "mobile.gitParity.queueNeedsThread": [
    "Create a conversation in this checkout to queue a workflow.",
    "Erstelle eine Unterhaltung in diesem Checkout, um einen Workflow zu planen.",
    "Créez une conversation dans cette copie du dépôt pour planifier un flux.",
  ],
  "mobile.gitParity.entireFile": ["Entire file", "Ganze Datei", "Fichier entier"],
  "mobile.gitParity.selectionCount": [
    "{{count}} selected",
    "{{count}} ausgewählt",
    "{{count}} sélectionnés",
  ],
  "mobile.gitParity.loadMore": [
    "Load more commits",
    "Weitere Commits laden",
    "Charger plus de commits",
  ],
  "mobile.gitParity.applyFilters": ["Apply filters", "Filter anwenden", "Appliquer les filtres"],
  "mobile.gitParity.refreshHistory": [
    "Refresh history",
    "Verlauf aktualisieren",
    "Actualiser l’historique",
  ],
  "mobile.gitParity.resolve": ["Mark resolved", "Als gelöst markieren", "Marquer comme résolu"],
  "mobile.gitParity.conflictMarkers": [
    "Remove conflict markers, save the result, then mark resolved.",
    "Konfliktmarkierungen entfernen, Ergebnis speichern und als gelöst markieren.",
    "Supprimez les marqueurs de conflit, enregistrez le résultat, puis marquez le conflit comme résolu.",
  ],
  "mobile.gitParity.edit": ["Edit file", "Datei bearbeiten", "Modifier le fichier"],
  "mobile.gitParity.closeEditor": ["Close editor", "Editor schließen", "Fermer l’éditeur"],
  "mobile.gitParity.unsavedTitle": [
    "Discard unsaved edits?",
    "Ungespeicherte Änderungen verwerfen?",
    "Abandonner les modifications non enregistrées ?",
  ],
  "mobile.gitParity.unsavedDescription": [
    "Your unsaved edits will be lost.",
    "Deine ungespeicherten Änderungen gehen verloren.",
    "Vos modifications non enregistrées seront perdues.",
  ],
  "mobile.gitParity.missingRevision": [
    "This server does not support safe file editing. Update the server to edit this file.",
    "Dieser Server unterstützt kein sicheres Bearbeiten von Dateien. Aktualisiere den Server, um die Datei zu bearbeiten.",
    "Ce serveur ne permet pas de modifier les fichiers en toute sécurité. Mettez-le à jour pour modifier ce fichier.",
  ],
  "mobile.gitParity.reload": [
    "Use current file",
    "Aktuelle Datei verwenden",
    "Utiliser le fichier actuel",
  ],
  "mobile.gitParity.keepMine": [
    "Replace with my edits",
    "Durch meine Änderungen ersetzen",
    "Remplacer par mes modifications",
  ],
  "mobile.gitParity.merge": [
    "Save merged text",
    "Zusammengeführten Text speichern",
    "Enregistrer le texte fusionné",
  ],
  "mobile.gitParity.concurrent": [
    "The file changed while you were editing. Compare the versions and choose what to save.",
    "Die Datei wurde während der Bearbeitung geändert. Vergleiche die Versionen und wähle, was gespeichert werden soll.",
    "Le fichier a changé pendant la modification. Comparez les versions et choisissez quoi enregistrer.",
  ],
  "mobile.gitParity.currentFile": ["Current file", "Aktuelle Datei", "Fichier actuel"],
  "mobile.gitParity.yourEdits": ["Your edits", "Deine Änderungen", "Vos modifications"],
  "mobile.gitParity.taskLists": ["Tasks", "Aufgaben", "Tâches"],
  "mobile.gitParity.commentLines": [
    "Comment on selected lines",
    "Ausgewählte Zeilen kommentieren",
    "Commenter les lignes sélectionnées",
  ],
  "mobile.gitParity.selectLines": [
    "Tap line numbers to select a range.",
    "Tippe auf die Zeilennummern, um einen Bereich auszuwählen.",
    "Touchez les numéros de ligne pour sélectionner une plage.",
  ],
  "mobile.gitParity.split": ["Split diff", "Geteilte Diff-Ansicht", "Diff côte à côte"],
  "mobile.gitParity.unified": ["Unified diff", "Vereinte Diff-Ansicht", "Diff unifié"],
  "mobile.gitParity.ignoreWhitespace": [
    "Ignore whitespace",
    "Leerzeichen ignorieren",
    "Ignorer les espaces",
  ],
  "mobile.gitParity.showWhitespace": [
    "Include whitespace changes",
    "Leerzeichenänderungen anzeigen",
    "Inclure les changements d’espaces",
  ],
  "mobile.gitParity.expandFiles": ["Expand files", "Dateien aufklappen", "Développer les fichiers"],
  "mobile.gitParity.collapseFiles": [
    "Collapse files",
    "Dateien einklappen",
    "Réduire les fichiers",
  ],
  "mobile.gitParity.projectWorkbench": [
    "Open project Git workbench",
    "Git-Workbench des Projekts öffnen",
    "Ouvrir l’espace Git du projet",
  ],
  "mobile.gitParity.operationConfirmation": [
    "Apply {{action}} to {{branch}}? Review the target before continuing.",
    "{{action}} auf {{branch}} anwenden? Prüfe das Ziel, bevor du fortfährst.",
    "Appliquer {{action}} à {{branch}} ? Vérifiez la cible avant de continuer.",
  ],
  "mobile.gitParity.queueMessage": [
    "Commit message (optional)",
    "Commit-Nachricht (optional)",
    "Message de commit (facultatif)",
  ],
  "mobile.gitParity.queuePaths": [
    "Paths, one per line",
    "Pfade, einer pro Zeile",
    "Chemins, un par ligne",
  ],
  "mobile.gitParity.rebaseInvalid": [
    "The rebase plan has invalid label references, or squash/fixup has no preceding commit.",
    "Der Rebase-Plan enthält ungültige Label-Verweise oder Squash/Fixup ohne vorherigen Commit.",
    "Le plan de rebase contient des références de labels invalides ou un squash/fixup sans commit précédent.",
  ],
  "mobile.gitParity.noRef": [
    "No upstream reference is available for force-with-lease.",
    "Für Force-with-lease ist keine Upstream-Referenz verfügbar.",
    "Aucune référence amont n’est disponible pour force-with-lease.",
  ],
});

export type MobileParityGitInterfaceMessageKey =
  (typeof mobileParityGitInterfaceCatalog.keys)[number];
