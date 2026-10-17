import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const composerInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "chat.responseMetrics.speedInline": ["{{speed}} tok/s", "{{speed}} Tok/s", "{{speed}} jetons/s"],
  "chat.responseMetrics.firstTokenInline": ["TTFT {{time}}", "TTFT {{time}}", "TTFT {{time}}"],
  "chat.responseMetrics.outputInline": [
    "{{tokens}} Tokens",
    "{{tokens}} Token",
    "{{tokens}} jetons",
  ],
  "chat.responseMetrics.contextInline": [
    "Context {{context}}",
    "Kontext {{context}}",
    "Contexte {{context}}",
  ],
  "chat.responseMetrics.speedTooltip": [
    "Average output tokens per second, including tool waits.",
    "Durchschnittliche Ausgabetoken pro Sekunde, inklusive Tool-Wartezeiten.",
    "Jetons de sortie par seconde en moyenne, attentes des outils comprises.",
  ],
  "chat.responseMetrics.firstTokenTooltip": [
    "Time from provider turn start to the first received token.",
    "Zeit vom Turn-Start beim Provider bis zum ersten empfangenen Token.",
    "Délai entre le début du tour chez le fournisseur et le premier jeton reçu.",
  ],
  "chat.responseMetrics.outputTooltip": [
    "Output tokens for the whole turn, including reasoning.",
    "Ausgabetoken für den gesamten Turn, inklusive Denken.",
    "Jetons de sortie pour tout le tour, raisonnement compris.",
  ],
  "chat.responseMetrics.contextTooltip": [
    "Final context tokens used and the model’s context limit.",
    "Zuletzt genutzte Kontexttoken und das Kontextlimit des Modells.",
    "Jetons de contexte utilisés à la fin et limite de contexte du modèle.",
  ],
  "chat.responseMetrics.seconds": ["{{seconds}} s", "{{seconds}} s", "{{seconds}} s"],
  "chat.responseMetrics.contextValue": [
    "{{used}} / {{limit}} ({{percentage}})",
    "{{used}} / {{limit}} ({{percentage}})",
    "{{used}} / {{limit}} ({{percentage}})",
  ],
  "chat.responseMetrics.contextValueUnknown": [
    "{{used}} / {{limit}}",
    "{{used}} / {{limit}}",
    "{{used}} / {{limit}}",
  ],
  "chat.contextMeter.title": ["Context usage", "Kontextnutzung", "Utilisation du contexte"],
  "chat.contextMeter.usedTokens": ["Used tokens", "Verwendete Token", "Jetons utilisés"],
  "chat.contextMeter.limit": ["Limit", "Limit", "Limite"],
  "chat.contextMeter.percentage": ["Percentage used", "Anteil genutzt", "Pourcentage utilisé"],
  "chat.contextMeter.limitUnknown": ["Limit unknown", "Limit unbekannt", "Limite inconnue"],
  "chat.contextMeter.processed": ["Total processed", "Insgesamt verarbeitet", "Total traité"],
  "chat.contextMeter.compact": ["Compact context", "Kontext komprimieren", "Compacter le contexte"],
  "chat.contextMeter.accessibleKnown": [
    "Context usage: {{used}} of {{limit}} tokens ({{percentage}} used)",
    "Kontextnutzung: {{used}} von {{limit}} Token ({{percentage}} genutzt)",
    "Utilisation du contexte : {{used}} sur {{limit}} jetons ({{percentage}} utilisés)",
  ],
  "chat.contextMeter.accessibleUnknown": [
    "Context usage: {{used}} tokens used. Limit unknown.",
    "Kontextnutzung: {{used}} Token verwendet. Limit unbekannt.",
    "Utilisation du contexte : {{used}} jetons utilisés. Limite inconnue.",
  ],
  "chat.contextMeter.autoCompactThreshold": [
    "Compacts automatically at {{tokens}} tokens.",
    "Wird bei {{tokens}} Token automatisch komprimiert.",
    "Compactage automatique à {{tokens}} jetons.",
  ],
  "chat.contextMeter.autoCompactModel": [
    "Context for {{model}} compacts automatically when needed.",
    "Der Kontext für {{model}} wird bei Bedarf automatisch komprimiert.",
    "Le contexte de {{model}} est compacté automatiquement si nécessaire.",
  ],
  "chat.contextMeter.autoCompact": [
    "Context compacts automatically when needed.",
    "Der Kontext wird bei Bedarf automatisch komprimiert.",
    "Le contexte est compacté automatiquement si nécessaire.",
  ],
  "chat.contextMeter.compactDisabledBusy": [
    "Wait for the current turn to finish before compacting context.",
    "Warte, bis der aktuelle Durchlauf beendet ist, um den Kontext zu komprimieren.",
    "Attendez la fin du tour en cours pour compacter le contexte.",
  ],
  "chat.contextMeter.compactDisabledNoSession": [
    "Send a message before compacting context.",
    "Sende eine Nachricht, bevor du den Kontext komprimierst.",
    "Envoyez un message avant de compacter le contexte.",
  ],
  "chat.contextMeter.compactDisabledDisconnected": [
    "Reconnect to compact context.",
    "Verbinde dich erneut, um den Kontext zu komprimieren.",
    "Reconnectez-vous pour compacter le contexte.",
  ],
  "chat.contextMeter.compactDisabledChooseProject": [
    "Choose a project before compacting",
    "Wähle vor dem Komprimieren ein Projekt aus",
    "Choisissez un projet avant de compacter",
  ],
  "chat.contextMeter.compactDisabledProvider": [
    "Compaction is unavailable for this provider",
    "Komprimierung ist für diesen Provider nicht verfügbar",
    "Le compactage n’est pas disponible pour ce fournisseur",
  ],
  "chat.contextMeter.compactDisabledUnavailable": [
    "Compacting is unavailable right now",
    "Komprimierung ist derzeit nicht verfügbar",
    "Le compactage n’est pas disponible pour le moment",
  ],
  "chat.composer.usageLimits.unavailable": [
    "Usage limits are unavailable for this provider",
    "Nutzungslimits sind für diesen Anbieter nicht verfügbar",
    "Les limites d’utilisation ne sont pas disponibles pour ce fournisseur",
  ],
  "chat.composer.usageLimits.visibilitySaveFailed": [
    "Unable to save usage limits visibility",
    "Die Sichtbarkeit der Nutzungslimits konnte nicht gespeichert werden",
    "Impossible d’enregistrer la visibilité des limites d’utilisation",
  ],
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
