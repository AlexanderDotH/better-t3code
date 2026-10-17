import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const deepPlanningInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "chat.deepPlan.label": ["Deep Plan", "Deep Plan", "Deep Plan"],
  "chat.deepPlan.ready": ["Deep Plan ready", "Deep Plan bereit", "Deep Plan prêt"],
  "chat.deepPlan.sources": ["Sources", "Quellen", "Sources"],
  "chat.deepPlan.scope": ["Scope", "Umfang", "Périmètre"],
  "chat.deepPlan.decisions": ["Decisions", "Entscheidungen", "Décisions"],
  "chat.deepPlan.affectedAreas": ["Affected areas", "Betroffene Bereiche", "Zones concernées"],
  "chat.deepPlan.dependencies": ["Depends on", "Abhängig von", "Dépend de"],
  "chat.deepPlan.checkMethod": ["Check", "Prüfung", "Vérification"],
  "chat.deepPlan.frozenSources": [
    "Sources are fixed for this Deep Plan.",
    "Die Quellen für diesen Deep Plan stehen fest.",
    "Les sources de ce Deep Plan sont figées.",
  ],
  "chat.deepPlan.projectSources": [
    { one: "{{count}} project chat", other: "{{count}} project chats" },
    { one: "{{count}} Projektchat", other: "{{count}} Projektchats" },
    { one: "{{count}} discussion du projet", other: "{{count}} discussions du projet" },
  ],
  "chat.deepPlan.extraSources": [
    { one: "{{count}} added chat", other: "{{count}} added chats" },
    { one: "{{count}} hinzugefügter Chat", other: "{{count}} hinzugefügte Chats" },
    { one: "{{count}} discussion ajoutée", other: "{{count}} discussions ajoutées" },
  ],
  "chat.deepPlan.chooseSources": ["Add chats", "Chats hinzufügen", "Ajouter des discussions"],
  "chat.deepPlan.searchSources": [
    "Search chats…",
    "Chats durchsuchen…",
    "Rechercher des discussions…",
  ],
  "chat.deepPlan.noSources": [
    "No chats found",
    "Keine Chats gefunden",
    "Aucune discussion trouvée",
  ],
  "chat.deepPlan.included": ["Included", "Enthalten", "Inclus"],
  "chat.deepPlan.removeSource": ["Remove {{title}}", "{{title}} entfernen", "Retirer {{title}}"],
  "chat.deepPlan.sourceUnavailable": [
    "Source unavailable",
    "Quelle nicht verfügbar",
    "Source indisponible",
  ],
  "chat.deepPlan.archived": ["Archived", "Archiviert", "Archivée"],
  "chat.deepPlan.analysisTitle": ["Deep analysis", "Tiefenanalyse", "Analyse approfondie"],
  "chat.deepPlan.startAnalysis": ["Start analysis", "Analyse starten", "Lancer l’analyse"],
  "chat.deepPlan.analysisProgress": [
    "{{completed}} of {{total}} sources analyzed",
    "{{completed}} von {{total}} Quellen analysiert",
    "{{completed}} sources analysées sur {{total}}",
  ],
  "chat.deepPlan.missingSources": [
    {
      one: "{{count}} source could not be analyzed",
      other: "{{count}} sources could not be analyzed",
    },
    {
      one: "{{count}} Quelle konnte nicht analysiert werden",
      other: "{{count}} Quellen konnten nicht analysiert werden",
    },
    {
      one: "{{count}} source n’a pas pu être analysée",
      other: "{{count}} sources n’ont pas pu être analysées",
    },
  ],
  "chat.deepPlan.retry": ["Retry", "Erneut versuchen", "Réessayer"],
  "chat.deepPlan.resume": ["Resume", "Fortsetzen", "Reprendre"],
  "chat.deepPlan.resuming": ["Resuming…", "Wird fortgesetzt…", "Reprise…"],
  "chat.deepPlan.resumeFailed": [
    "Could not resume Deep Plan",
    "Deep Plan konnte nicht fortgesetzt werden",
    "Impossible de reprendre Deep Plan",
  ],
  "chat.deepPlan.planVersion": [
    "Version {{version}}",
    "Version {{version}}",
    "Version {{version}}",
  ],
  "chat.deepPlan.contentVersion": [
    "Source version {{version}}",
    "Quellenversion {{version}}",
    "Version de la source {{version}}",
  ],
  "chat.deepPlan.sourceVersion": [
    {
      one: "{{count}} source · Version {{version}}",
      other: "{{count}} sources · Version {{version}}",
    },
    {
      one: "{{count}} Quelle · Version {{version}}",
      other: "{{count}} Quellen · Version {{version}}",
    },
    {
      one: "{{count}} source · Version {{version}}",
      other: "{{count}} sources · Version {{version}}",
    },
  ],
  "chat.deepPlan.refine": ["Refine plan", "Plan überarbeiten", "Affiner le plan"],
  "chat.deepPlan.implement": ["Implement plan", "Plan umsetzen", "Mettre en œuvre le plan"],
  "chat.deepPlan.implementNewThread": [
    "Implement in new thread",
    "In neuem Chat umsetzen",
    "Mettre en œuvre dans une nouvelle discussion",
  ],
  "chat.deepPlan.parallelism": ["Parallelism", "Parallelität", "Parallélisme"],
  "chat.deepPlan.checklist": ["Deep checklist", "Deep-Checkliste", "Liste de suivi approfondie"],
  "chat.deepPlan.stepProgress": [
    "{{completed}} of {{total}} verified",
    "{{completed}} von {{total}} geprüft",
    "{{completed}} vérifiés sur {{total}}",
  ],
  "chat.deepPlan.currentStep": ["Current: {{title}}", "Aktuell: {{title}}", "En cours : {{title}}"],
  "chat.deepPlan.requirements": ["Requirements", "Anforderungen", "Exigences"],
  "chat.deepPlan.evidence": ["Evidence", "Nachweise", "Preuves"],
  "chat.deepPlan.finalValidation": ["Final validation", "Abschlussprüfung", "Validation finale"],
  "chat.deepPlan.startFinalValidation": [
    "Run final validation",
    "Abschlussprüfung starten",
    "Lancer la validation finale",
  ],
  "chat.deepPlan.status.open": ["Open", "Offen", "Ouvert"],
  "chat.deepPlan.status.pending": ["Pending", "Ausstehend", "En attente"],
  "chat.deepPlan.status.inProgress": ["In progress", "In Bearbeitung", "En cours"],
  "chat.deepPlan.status.implemented": ["Implemented", "Umgesetzt", "Mis en œuvre"],
  "chat.deepPlan.status.verified": ["Verified", "Geprüft", "Vérifié"],
  "chat.deepPlan.status.failed": ["Failed", "Fehlgeschlagen", "Échec"],
  "chat.deepPlan.status.blocked": ["Blocked", "Blockiert", "Bloqué"],
  "chat.deepPlan.collapse": [
    "Collapse checklist",
    "Checkliste einklappen",
    "Réduire la liste de suivi",
  ],
  "chat.deepPlan.expand": [
    "Expand checklist",
    "Checkliste ausklappen",
    "Développer la liste de suivi",
  ],
  "chat.deepPlan.unavailable": [
    "Deep Planning is unavailable on this server",
    "Deep Planning ist auf diesem Server nicht verfügbar",
    "Deep Planning n’est pas disponible sur ce serveur",
  ],
  "chat.deepPlan.providerUnavailable": [
    "Deep Planning is unavailable for this provider",
    "Deep Planning ist für diesen Provider nicht verfügbar",
    "Deep Planning n’est pas disponible pour ce fournisseur",
  ],
  "chat.deepPlan.singleModel": [
    "Choose one model for Deep Planning.",
    "Wähle ein Modell für Deep Planning.",
    "Choisissez un seul modèle pour Deep Planning.",
  ],
  "chat.deepPlan.replyUnavailable": [
    "Deep Planning is unavailable in a message reply. Close the reply to continue.",
    "Deep Planning ist in einer Nachrichtenantwort nicht verfügbar. Schließe die Antwort, um fortzufahren.",
    "Deep Planning n’est pas disponible dans une réponse à un message. Fermez la réponse pour continuer.",
  ],
  "chat.deepPlan.reason.connect": [
    "Connect to this environment to use Deep Plan.",
    "Verbinde dich mit dieser Umgebung, um Deep Plan zu nutzen.",
    "Connectez-vous à cet environnement pour utiliser Deep Plan.",
  ],
  "chat.deepPlan.reason.provider": [
    "Select a provider to use Deep Plan.",
    "Wähle einen Provider aus, um Deep Plan zu nutzen.",
    "Choisissez un fournisseur pour utiliser Deep Plan.",
  ],
  "chat.deepPlan.reason.unavailableProvider": [
    "The selected provider is unavailable.",
    "Der ausgewählte Provider ist nicht verfügbar.",
    "Le fournisseur sélectionné est indisponible.",
  ],
  "chat.deepPlan.sourceCount": [
    { one: "{{count}} chat", other: "{{count}} chats" },
    { one: "{{count}} Chat", other: "{{count}} Chats" },
    { one: "{{count}} discussion", other: "{{count}} discussions" },
  ],
  "chat.deepPlan.allProjectChats": [
    "All current project chats, including archived chats",
    "Alle Chats des aktuellen Projekts, einschließlich archivierter Chats",
    "Toutes les discussions du projet actuel, y compris les discussions archivées",
  ],
  "chat.deepPlan.preparing": [
    "Preparing sources…",
    "Quellen werden vorbereitet…",
    "Préparation des sources…",
  ],
  "chat.deepPlan.selectionHint": [
    "Project chats are included automatically. Add chats from other projects or environments.",
    "Projektchats werden automatisch einbezogen. Füge Chats aus anderen Projekten oder Umgebungen hinzu.",
    "Les discussions du projet sont incluses automatiquement. Ajoutez des discussions d’autres projets ou environnements.",
  ],
  "chat.deepPlan.analysisPending": [
    "Waiting for source analysis",
    "Quellenanalyse steht aus",
    "En attente de l’analyse des sources",
  ],
  "chat.deepPlan.noEvidence": [
    "No evidence recorded",
    "Keine Nachweise erfasst",
    "Aucune preuve enregistrée",
  ],
  "chat.deepPlan.validationPending": [
    "Final validation has not run",
    "Die Abschlussprüfung steht aus",
    "La validation finale n’a pas encore été effectuée",
  ],
  "chat.deepPlan.missingSourceHint": [
    "Resolve missing sources before approving the plan",
    "Kläre fehlende Quellen, bevor du den Plan freigibst",
    "Récupérez les sources manquantes avant d’approuver le plan",
  ],
  "chat.deepPlan.done": ["Done", "Fertig", "Terminé"],
  "chat.deepPlan.modeLabel": ["Mode: {{mode}}", "Modus: {{mode}}", "Mode : {{mode}}"],
  "chat.deepPlan.changeMode": ["Change mode", "Modus wechseln", "Changer de mode"],
  "chat.deepPlan.cycleMode": ["Switch to {{mode}}", "Zu {{mode}} wechseln", "Passer à {{mode}}"],
  "chat.deepPlan.slashDescription": [
    "Analyze project chats and create a detailed plan",
    "Projektchats analysieren und einen detaillierten Plan erstellen",
    "Analyser les discussions du projet et créer un plan détaillé",
  ],
});

export type DeepPlanningInterfaceMessageKey = (typeof deepPlanningInterfaceCatalog.keys)[number];
