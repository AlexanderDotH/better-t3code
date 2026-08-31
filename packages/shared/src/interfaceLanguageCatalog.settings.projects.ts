import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const settingsProjectsInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "settings.projects.appearance.chatVisualReset": [
    "chat visuals",
    "Chatdarstellung",
    "affichage des discussions",
  ],
  "settings.projects.appearance.sidebarOptionAria": [
    "{{mode}} sidebar",
    "Seitenleiste {{mode}}",
    "Barre latérale {{mode}}",
  ],
  "settings.projects.detail.breadcrumb": [
    "Project settings breadcrumb",
    "Breadcrumb für Projekteinstellungen",
    "Fil d’Ariane des réglages du projet",
  ],
  "settings.projects.detail.projects": ["Projects", "Projekte", "Projets"],
  "settings.projects.detail.switchProject": [
    "Switch project",
    "Projekt wechseln",
    "Changer de projet",
  ],
  "settings.projects.detail.unavailable": [
    "Unavailable project",
    "Projekt nicht verfügbar",
    "Projet indisponible",
  ],
  "settings.projects.detail.empty.configure": [
    "Add a project from the sidebar to configure it here.",
    "Füge über die Seitenleiste ein Projekt hinzu, um es hier zu konfigurieren.",
    "Ajoutez un projet depuis la barre latérale pour le configurer ici.",
  ],
  "settings.projects.detail.empty.removed": [
    "This project is no longer available.",
    "Dieses Projekt ist nicht mehr verfügbar.",
    "Ce projet n’est plus disponible.",
  ],
  "settings.projects.detail.error.unexpected": [
    "An error occurred.",
    "Ein Fehler ist aufgetreten.",
    "Une erreur s’est produite.",
  ],
  "settings.projects.detail.pathCopied": ["Path copied", "Pfad kopiert", "Chemin copié"],
  "settings.projects.detail.copyPathFailed": [
    "Failed to copy path",
    "Pfad konnte nicht kopiert werden",
    "Échec de la copie du chemin",
  ],
  "settings.projects.detail.titleEmpty": [
    "Project title cannot be empty",
    "Der Projekttitel darf nicht leer sein",
    "Le titre du projet ne peut pas être vide",
  ],
  "settings.projects.detail.failure.rename": [
    "Failed to rename project",
    "Projekt konnte nicht umbenannt werden",
    "Échec du renommage du projet",
  ],
  "settings.projects.detail.failure.defaultModel": [
    "Failed to update default model",
    "Standardmodell konnte nicht aktualisiert werden",
    "Échec de la mise à jour du modèle par défaut",
  ],
  "settings.projects.detail.failure.workspace": [
    "Failed to update new-thread workspace",
    "Workspace für neue Chats konnte nicht aktualisiert werden",
    "Échec de la mise à jour de l’espace de travail des nouvelles discussions",
  ],
  "settings.projects.detail.failure.checkpoints": [
    "Failed to update checkpoint setting",
    "Checkpoint-Einstellung konnte nicht aktualisiert werden",
    "Échec de la mise à jour du réglage des points de contrôle",
  ],
  "settings.projects.detail.failure.icon": [
    "Failed to update project icon",
    "Projektsymbol konnte nicht aktualisiert werden",
    "Échec de la mise à jour de l’icône du projet",
  ],
  "settings.projects.detail.failure.scripts": [
    "Failed to save actions",
    "Aktionen konnten nicht gespeichert werden",
    "Échec de l’enregistrement des actions",
  ],
  "settings.projects.detail.failure.keybinding": [
    "Failed to save keybinding",
    "Tastenkürzel konnte nicht gespeichert werden",
    "Échec de l’enregistrement du raccourci clavier",
  ],
  "settings.projects.detail.failure.removeKeybinding": [
    "Failed to remove keybinding",
    "Tastenkürzel konnte nicht entfernt werden",
    "Échec de la suppression du raccourci clavier",
  ],
  "settings.projects.detail.failure.importAction": [
    "Failed to import action.",
    "Aktion konnte nicht importiert werden.",
    "Échec de l’importation de l’action.",
  ],
  "settings.projects.detail.failure.removeNamed": [
    "Failed to remove {{project}}",
    "{{project}} konnte nicht entfernt werden",
    "Échec du retrait de {{project}}",
  ],
  "settings.projects.detail.savingConflict": [
    "Another action change is still saving. Try again.",
    "Eine andere Aktionsänderung wird noch gespeichert. Versuche es erneut.",
    "Une autre modification d’action est encore en cours d’enregistrement. Réessayez.",
  ],
  "settings.projects.detail.section.project": ["Project", "Projekt", "Projet"],
  "settings.projects.detail.name": ["Name", "Name", "Nom"],
  "settings.projects.detail.nameDescription": [
    "The shared name for this project group in the sidebar and thread lists.",
    "Der gemeinsame Name dieser Projektgruppe in der Seitenleiste und den Chatlisten.",
    "Le nom partagé de ce groupe de projets dans la barre latérale et les listes de discussions.",
  ],
  "settings.projects.detail.projectName": ["Project name", "Projektname", "Nom du projet"],
  "settings.projects.detail.icon": ["Project icon", "Projektsymbol", "Icône du projet"],
  "settings.projects.detail.iconReset": ["project icon", "Projektsymbol", "icône du projet"],
  "settings.projects.detail.automatic": ["Automatic", "Automatisch", "Automatique"],
  "settings.projects.detail.chooseIconFile": [
    "Choose a project icon file",
    "Datei für das Projektsymbol auswählen",
    "Choisir un fichier d’icône de projet",
  ],
  "settings.projects.detail.chooseFile": ["Choose file", "Datei auswählen", "Choisir un fichier"],
  "settings.projects.detail.section.newThreads": [
    "New threads",
    "Neue Chats",
    "Nouvelles discussions",
  ],
  "settings.projects.detail.model": ["Model", "Modell", "Modèle"],
  "settings.projects.detail.modelDescription": [
    "New threads in this project start with this model. Applies to every checkout in this group.",
    "Neue Chats in diesem Projekt starten mit diesem Modell. Gilt für jeden Checkout dieser Gruppe.",
    "Les nouvelles discussions de ce projet démarrent avec ce modèle. S’applique à chaque extraction du groupe.",
  ],
  "settings.projects.detail.modelReset": [
    "project default model",
    "Standardmodell des Projekts",
    "modèle par défaut du projet",
  ],
  "settings.projects.detail.noProviders": [
    "No providers available",
    "Keine Provider verfügbar",
    "Aucun fournisseur disponible",
  ],
  "settings.projects.detail.workspace": ["Workspace", "Workspace", "Espace de travail"],
  "settings.projects.detail.workspaceDescription": [
    "Where new threads in this project start. Overrides t3.json and the global default; applies to every checkout in this group.",
    "Legt fest, wo neue Chats in diesem Projekt starten. Überschreibt t3.json und den globalen Standard; gilt für jeden Checkout dieser Gruppe.",
    "Définit où commencent les nouvelles discussions de ce projet. Remplace t3.json et le réglage global ; s’applique à chaque extraction du groupe.",
  ],
  "settings.projects.detail.workspaceReset": [
    "project workspace default",
    "Workspace-Standard des Projekts",
    "espace de travail par défaut du projet",
  ],
  "settings.projects.detail.workspaceAria": [
    "New-thread workspace",
    "Workspace für neue Chats",
    "Espace de travail des nouvelles discussions",
  ],
  "settings.projects.detail.workspace.defaultPerCheckout": [
    "Default (per checkout)",
    "Standard (pro Checkout)",
    "Par défaut (par extraction)",
  ],
  "settings.projects.detail.workspace.defaultResolved": [
    "Default ({{mode}})",
    "Standard ({{mode}})",
    "Par défaut ({{mode}})",
  ],
  "settings.projects.detail.workspace.defaultEach": [
    "Default (each checkout's t3.json or global setting)",
    "Standard (t3.json jedes Checkouts oder globale Einstellung)",
    "Par défaut (t3.json de chaque extraction ou réglage global)",
  ],
  "settings.projects.detail.workspace.defaultSource": [
    "Default ({{source}}: {{mode}})",
    "Standard ({{source}}: {{mode}})",
    "Par défaut ({{source}} : {{mode}})",
  ],
  "settings.projects.detail.workspace.currentCheckout": [
    "Current checkout",
    "Aktueller Checkout",
    "Extraction actuelle",
  ],
  "settings.projects.detail.workspace.newWorktree": [
    "New worktree",
    "Neuer Worktree",
    "Nouvel arbre de travail",
  ],
  "settings.projects.detail.workspace.global": ["global", "global", "global"],
  "settings.projects.detail.section.checkpoints": [
    "Checkpoints",
    "Checkpoints",
    "Points de contrôle",
  ],
  "settings.projects.detail.checkpointDescription": [
    "Save hidden Git checkpoints before and after turns for diffs and restore. Disable this for very large repositories to avoid checkpoint overhead. Each grouped checkout stores its own value; mixed values can be normalized here.",
    "Speichert vor und nach Durchläufen verborgene Git-Checkpoints für Diffs und Wiederherstellung. Bei sehr großen Repositories kann dies deaktiviert werden. Jeder gruppierte Checkout speichert seinen eigenen Wert; gemischte Werte lassen sich hier vereinheitlichen.",
    "Enregistre des points de contrôle Git masqués avant et après les tours pour les différences et la restauration. Désactivez-les pour les très grands dépôts. Chaque extraction groupée conserve sa valeur ; les valeurs mixtes peuvent être harmonisées ici.",
  ],
  "settings.projects.detail.section.checkout": ["Checkout", "Checkout", "Extraction"],
  "settings.projects.detail.selectedCheckout": [
    "Selected checkout",
    "Ausgewählter Checkout",
    "Extraction sélectionnée",
  ],
  "settings.projects.detail.thisMachine": ["This machine", "Dieser Rechner", "Cette machine"],
  "settings.projects.detail.copyCheckoutPath": [
    "Copy checkout path",
    "Checkout-Pfad kopieren",
    "Copier le chemin de l’extraction",
  ],
  "settings.projects.detail.copyPath": ["Copy path", "Pfad kopieren", "Copier le chemin"],
  "settings.projects.detail.threadCount": [
    { one: "{{count}} thread", other: "{{count}} threads" },
    { one: "{{count}} Chat", other: "{{count}} Chats" },
    { one: "{{count}} discussion", other: "{{count}} discussions" },
  ],
  "settings.projects.detail.grouping.title": [
    "Project grouping",
    "Projektgruppierung",
    "Regroupement des projets",
  ],
  "settings.projects.detail.grouping.description": [
    "How this checkout joins project groups in the sidebar. Changing it can move you to a different project group.",
    "Legt fest, wie dieser Checkout Projektgruppen in der Seitenleiste beitritt. Eine Änderung kann ihn in eine andere Projektgruppe verschieben.",
    "Définit comment cette extraction rejoint les groupes de projets dans la barre latérale. Une modification peut la déplacer vers un autre groupe.",
  ],
  "settings.projects.detail.grouping.aria": [
    "Grouping rule for {{checkout}}",
    "Gruppierungsregel für {{checkout}}",
    "Règle de regroupement pour {{checkout}}",
  ],
  "settings.projects.detail.grouping.default": [
    "Default ({{mode}})",
    "Standard ({{mode}})",
    "Par défaut ({{mode}})",
  ],
  "settings.projects.detail.grouping.inherit": [
    "Use global default",
    "Globalen Standard verwenden",
    "Utiliser le réglage global",
  ],
  "settings.projects.detail.grouping.repository": [
    "Group by repository",
    "Nach Repository gruppieren",
    "Regrouper par dépôt",
  ],
  "settings.projects.detail.grouping.repositoryPath": [
    "Group by repository path",
    "Nach Repository-Pfad gruppieren",
    "Regrouper par chemin de dépôt",
  ],
  "settings.projects.detail.grouping.separate": [
    "Keep separate",
    "Getrennt halten",
    "Garder séparé",
  ],
  "settings.projects.detail.removeCheckout.title": [
    "Remove checkout",
    "Checkout entfernen",
    "Retirer l’extraction",
  ],
  "settings.projects.detail.removeCheckout.description": [
    "Removes this checkout and its threads from the project group. Files on disk are not touched.",
    "Entfernt diesen Checkout und seine Chats aus der Projektgruppe. Dateien auf dem Datenträger bleiben unverändert.",
    "Retire cette extraction et ses discussions du groupe de projets. Les fichiers sur le disque ne sont pas modifiés.",
  ],
  "settings.projects.detail.actions.title": ["Actions", "Aktionen", "Actions"],
  "settings.projects.detail.actions.description": [
    "Saved and run only in {{checkout}}.",
    "Werden nur in {{checkout}} gespeichert und ausgeführt.",
    "Enregistrées et exécutées uniquement dans {{checkout}}.",
  ],
  "settings.projects.detail.actions.import": [
    "Import actions",
    "Aktionen importieren",
    "Importer des actions",
  ],
  "settings.projects.detail.actions.importFromFile": [
    "Import from t3.json",
    "Aus t3.json importieren",
    "Importer depuis t3.json",
  ],
  "settings.projects.detail.actions.importDescription": [
    "Add actions declared by this checkout without editing them first.",
    "Fügt die von diesem Checkout deklarierten Aktionen hinzu, ohne sie zuvor zu bearbeiten.",
    "Ajoute les actions déclarées par cette extraction sans les modifier au préalable.",
  ],
  "settings.projects.detail.actions.add": ["Add action", "Aktion hinzufügen", "Ajouter une action"],
  "settings.projects.detail.actions.empty": [
    "No actions configured for this checkout.",
    "Für diesen Checkout sind keine Aktionen konfiguriert.",
    "Aucune action n’est configurée pour cette extraction.",
  ],
  "settings.projects.detail.actions.setup": ["setup", "Setup", "configuration"],
  "settings.projects.detail.actions.previewDesktop": [
    "preview · desktop only",
    "Vorschau · nur Desktop",
    "aperçu · bureau uniquement",
  ],
  "settings.projects.detail.actions.edit": [
    "Edit {{name}}",
    "{{name}} bearbeiten",
    "Modifier {{name}}",
  ],
  "settings.projects.detail.invalidFile.title": [
    "t3.json is invalid",
    "t3.json ist ungültig",
    "t3.json n’est pas valide",
  ],
  "settings.projects.detail.invalidFile.description": [
    "A t3.json exists in this checkout but fails to parse, so every action and icon it declares is ignored. Check the JSON syntax and icon values.",
    "Dieser Checkout enthält eine t3.json, die nicht gelesen werden kann. Daher werden alle darin deklarierten Aktionen und Symbole ignoriert. Prüfe die JSON-Syntax und Symbolwerte.",
    "Une t3.json existe dans cette extraction mais ne peut pas être analysée. Toutes les actions et icônes qu’elle déclare sont donc ignorées. Vérifiez la syntaxe JSON et les valeurs d’icône.",
  ],
  "settings.projects.detail.section.danger": ["Danger", "Gefahrenbereich", "Danger"],
  "settings.projects.detail.removeEverywhere": [
    "Remove this project everywhere",
    "Dieses Projekt überall entfernen",
    "Retirer ce projet partout",
  ],
  "settings.projects.detail.removeProject": [
    "Remove project",
    "Projekt entfernen",
    "Retirer le projet",
  ],
  "settings.projects.detail.removeEverywhereDescription": [
    "Deletes all {{count}} checkout entries and their threads on every machine. Files on disk are not touched.",
    "Löscht alle {{count}} Checkout-Einträge und ihre Chats auf jedem Rechner. Dateien auf dem Datenträger bleiben unverändert.",
    "Supprime les {{count}} entrées d’extraction et leurs discussions sur chaque machine. Les fichiers sur le disque ne sont pas modifiés.",
  ],
  "settings.projects.detail.removeProjectDescription": [
    "Deletes the project entry and its threads. Files on disk are not touched.",
    "Löscht den Projekteintrag und seine Chats. Dateien auf dem Datenträger bleiben unverändert.",
    "Supprime l’entrée de projet et ses discussions. Les fichiers sur le disque ne sont pas modifiés.",
  ],
  "settings.projects.detail.removeAll": [
    "Remove all entries",
    "Alle Einträge entfernen",
    "Retirer toutes les entrées",
  ],
  "settings.projects.detail.confirm.removeWithThreads": [
    {
      one: "Remove project {{project}} and delete its {{count}} thread?",
      other: "Remove project {{project}} and delete its {{count}} threads?",
    },
    {
      one: "Projekt {{project}} entfernen und seinen {{count}} Chat löschen?",
      other: "Projekt {{project}} entfernen und seine {{count}} Chats löschen?",
    },
    {
      one: "Retirer le projet {{project}} et supprimer sa {{count}} discussion ?",
      other: "Retirer le projet {{project}} et supprimer ses {{count}} discussions ?",
    },
  ],
  "settings.projects.detail.confirm.remove": [
    "Remove project {{project}}?",
    "Projekt {{project}} entfernen?",
    "Retirer le projet {{project}} ?",
  ],
  "settings.projects.detail.confirm.path": [
    "Path: {{path}}",
    "Pfad: {{path}}",
    "Chemin : {{path}}",
  ],
  "settings.projects.detail.confirm.environment": [
    "Environment: {{environment}}",
    "Umgebung: {{environment}}",
    "Environnement : {{environment}}",
  ],
  "settings.projects.detail.confirm.groupedEntries": [
    {
      one: "This removes {{count}} grouped project entry.",
      other: "This removes {{count}} grouped project entries.",
    },
    {
      one: "Dadurch wird {{count}} gruppierter Projekteintrag entfernt.",
      other: "Dadurch werden {{count}} gruppierte Projekteinträge entfernt.",
    },
    {
      one: "Cette action retire {{count}} entrée de projet regroupée.",
      other: "Cette action retire {{count}} entrées de projet regroupées.",
    },
  ],
  "settings.projects.detail.confirm.historyWarning": [
    "This permanently clears conversation history for those threads.",
    "Dadurch wird der Gesprächsverlauf dieser Chats dauerhaft gelöscht.",
    "Cette action efface définitivement l’historique de ces discussions.",
  ],
  "settings.projects.detail.confirm.entriesOnly": [
    "This removes only the project entries, not the files on disk.",
    "Dadurch werden nur die Projekteinträge entfernt, nicht die Dateien auf dem Datenträger.",
    "Cette action retire uniquement les entrées de projet, pas les fichiers sur le disque.",
  ],
  "settings.projects.detail.confirm.othersUnaffected": [
    "Other entries in this grouped project are unaffected.",
    "Andere Einträge in diesem gruppierten Projekt bleiben unverändert.",
    "Les autres entrées de ce projet regroupé ne sont pas affectées.",
  ],
  "settings.projects.detail.confirm.cannotUndo": [
    "This action cannot be undone.",
    "Diese Aktion kann nicht rückgängig gemacht werden.",
    "Cette action est irréversible.",
  ],
  "settings.projects.iconPicker.choose": [
    "Choose project icon",
    "Projektsymbol auswählen",
    "Choisir l’icône du projet",
  ],
  "settings.projects.iconPicker.select": [
    "Select icon",
    "Symbol auswählen",
    "Sélectionner l’icône",
  ],
  "settings.projects.iconPicker.openFailed": [
    "Could not open image picker",
    "Bildauswahl konnte nicht geöffnet werden",
    "Impossible d’ouvrir le sélecteur d’images",
  ],
  "settings.projects.iconPicker.openIn": [
    "Open in {{fileManager}}",
    "In {{fileManager}} öffnen",
    "Ouvrir dans {{fileManager}}",
  ],
  "settings.projects.iconPicker.searchPlaceholder": [
    "Search image files…",
    "Bilddateien suchen…",
    "Rechercher des fichiers image…",
  ],
  "settings.projects.iconPicker.searching": [
    "Searching project files…",
    "Projektdateien werden durchsucht…",
    "Recherche dans les fichiers du projet…",
  ],
  "settings.projects.iconPicker.indexing": [
    "Indexing project files…",
    "Projektdateien werden indexiert…",
    "Indexation des fichiers du projet…",
  ],
  "settings.projects.iconPicker.noMatches": [
    "No matching image files.",
    "Keine passenden Bilddateien.",
    "Aucun fichier image correspondant.",
  ],
  "settings.projects.iconPicker.noImages": [
    "No image files found.",
    "Keine Bilddateien gefunden.",
    "Aucun fichier image trouvé.",
  ],
});

export type SettingsProjectsInterfaceMessageKey =
  (typeof settingsProjectsInterfaceCatalog.keys)[number];
