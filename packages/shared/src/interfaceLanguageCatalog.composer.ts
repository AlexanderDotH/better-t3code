import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const composerInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "chat.composer.sync.loadingMessages": [
    "Loading messages...",
    "Nachrichten werden geladen...",
    "Chargement des messages...",
  ],
  "chat.composer.sync.syncingMessages": [
    "Syncing messages...",
    "Nachrichten werden synchronisiert...",
    "Synchronisation des messages...",
  ],
  "chat.composer.approval.label.mcpElicitation": [
    "App access approval",
    "App-Zugriff genehmigen",
    "Approbation d’accès à l’application",
  ],
  "chat.composer.approval.label.command": [
    "Command approval",
    "Befehl genehmigen",
    "Approbation de commande",
  ],
  "chat.composer.approval.label.fileRead": [
    "File read approval",
    "Dateizugriff genehmigen",
    "Approbation de lecture de fichier",
  ],
  "chat.composer.approval.label.fileChange": [
    "File change approval",
    "Dateiänderung genehmigen",
    "Approbation de modification de fichier",
  ],
  "chat.composer.approval.detail.mcpElicitation": [
    "App access request",
    "App-Zugriffsanfrage",
    "Demande d’accès à l’application",
  ],
  "chat.composer.approval.detail.command": ["Command", "Befehl", "Commande"],
  "chat.composer.approval.detail.fileRead": ["File to read", "Zu lesende Datei", "Fichier à lire"],
  "chat.composer.approval.detail.fileChange": [
    "File change",
    "Dateiänderung",
    "Modification de fichier",
  ],
  "chat.composer.userInput.showQuestionOptions": [
    "Show the question and its options",
    "Frage und Antwortoptionen anzeigen",
    "Afficher la question et ses options",
  ],
  "chat.composer.userInput.hideQuestionOptions": [
    "Hide the question and its options",
    "Frage und Antwortoptionen ausblenden",
    "Masquer la question et ses options",
  ],
  "chat.composer.command.source.app": ["App", "App", "Application"],
  "chat.composer.command.source.repo": ["Repo", "Repository", "Dépôt"],
  "chat.composer.command.source.project": ["Project", "Projekt", "Projet"],
  "chat.composer.command.source.personal": ["Personal", "Persönlich", "Personnel"],
  "chat.composer.command.source.system": ["System", "System", "Système"],
  "chat.composer.command.source.provider": ["Provider", "Provider", "Fournisseur"],
  "chat.composer.command.sourceSkill": [
    "{{source}} Skill",
    "{{source}}-Skill",
    "Compétence {{source}}",
  ],
  "chat.composer.stash.time.justNow": ["just now", "gerade eben", "à l’instant"],
  "chat.composer.stash.time.minutesAgo": [
    "{{count}}m ago",
    "vor {{count}} Min.",
    "il y a {{count}} min",
  ],
  "chat.composer.stash.time.hoursAgo": [
    "{{count}}h ago",
    "vor {{count}} Std.",
    "il y a {{count}} h",
  ],
  "chat.composer.stash.time.daysAgo": ["{{count}}d ago", "vor {{count}} T.", "il y a {{count}} j"],
});

export type ComposerInterfaceMessageKey = (typeof composerInterfaceCatalog.keys)[number];
