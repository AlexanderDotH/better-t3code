import {
  BETTER_T3_FEATURE_REGISTRY,
  type BetterT3FeatureControlKind,
  type BetterT3FeatureId,
} from "@t3tools/contracts";

import {
  defineLocalizedInterfaceCatalog,
  type InterfaceCatalogLanguage,
  type InterfaceMessageTemplate,
  type LocalizedInterfaceCatalog,
} from "./interfaceLanguageCatalog.types.ts";

const betterT3SettingsCatalog = defineLocalizedInterfaceCatalog({
  "settings.betterT3.title": ["Better T3", "Better T3", "Better T3"],
  "settings.betterT3.description": [
    "Control Better T3 features without weakening correctness or data-safety guarantees.",
    "Better-T3-Funktionen steuern, ohne Korrektheits- oder Datensicherheitsgarantien abzuschwächen.",
    "Contrôlez les fonctions Better T3 sans affaiblir les garanties de fiabilité ou de sécurité des données.",
  ],
  "settings.betterT3.deviceScope": ["This device", "Dieses Gerät", "Cet appareil"],
  "settings.betterT3.environmentScope": [
    "Selected environment",
    "Ausgewählte Umgebung",
    "Environnement sélectionné",
  ],
  "settings.betterT3.selectEnvironment": [
    "Select an environment",
    "Umgebung auswählen",
    "Sélectionner un environnement",
  ],
  "settings.betterT3.noEnvironment": [
    "Connect an environment to change this setting.",
    "Eine Umgebung verbinden, um diese Einstellung zu ändern.",
    "Connectez un environnement pour modifier ce réglage.",
  ],
  "settings.betterT3.deviceLoading": [
    "Device preferences are still loading.",
    "Geräteeinstellungen werden noch geladen.",
    "Les préférences de l’appareil sont encore en cours de chargement.",
  ],
  "settings.betterT3.tab.general": ["General", "Allgemein", "Général"],
  "settings.betterT3.tab.agents": ["Agents", "Agenten", "Agents"],
  "settings.betterT3.tab.visual": ["Visual", "Darstellung", "Visuel"],
  "settings.betterT3.tab.workspace": ["Workspace", "Workspace", "Espace de travail"],
  "settings.betterT3.tab.voice": ["Voice", "Spracheingabe", "Voix"],
  "settings.betterT3.tab.knowledge": ["Knowledge", "Wissen", "Connaissances"],
  "settings.betterT3.tab.system": ["System", "System", "Système"],
  "settings.betterT3.tab.integrations": ["Integrations", "Integrationen", "Intégrations"],
  "settings.betterT3.advancedSettings": [
    "Advanced settings",
    "Erweiterte Einstellungen",
    "Réglages avancés",
  ],
  "settings.betterT3.section.agent-workflows": [
    "Agent workflows",
    "Agenten-Workflows",
    "Flux de travail des agents",
  ],
  "settings.betterT3.section.chat-layout": [
    "Chat and layout",
    "Chat und Layout",
    "Discussion et mise en page",
  ],
  "settings.betterT3.section.workspace-source-control": [
    "Workspace and source control",
    "Workspace und Versionsverwaltung",
    "Espace de travail et gestion de sources",
  ],
  "settings.betterT3.section.voice-synchronization": [
    "Voice and synchronization",
    "Spracheingabe und Synchronisierung",
    "Voix et synchronisation",
  ],
  "settings.betterT3.section.knowledge-automation": [
    "Knowledge and automation",
    "Wissen und Automatisierung",
    "Connaissances et automatisation",
  ],
  "settings.betterT3.section.resource-protection": [
    "Resource protection",
    "Ressourcenschutz",
    "Protection des ressources",
  ],
  "settings.betterT3.section.integration-status": [
    "Integration status",
    "Integrationsstatus",
    "État des intégrations",
  ],
  "settings.betterT3.section.interface": ["Interface", "Oberfläche", "Interface"],
  "settings.betterT3.preview.live": ["Live preview", "Live-Vorschau", "Aperçu en direct"],
  "settings.betterT3.preview.agent.title": [
    "Agent workflow preview",
    "Vorschau der Agenten-Workflows",
    "Aperçu des flux d’agents",
  ],
  "settings.betterT3.preview.agent.description": [
    "Updates as you change the workflow settings below.",
    "Aktualisiert sich, wenn du die Workflow-Einstellungen unten änderst.",
    "Se met à jour lorsque vous modifiez les réglages ci-dessous.",
  ],
  "settings.betterT3.preview.agent.prompt": ["Your request", "Deine Anfrage", "Votre demande"],
  "settings.betterT3.preview.agent.plan": ["Plan", "Plan", "Plan"],
  "settings.betterT3.preview.agent.build": ["Build", "Umsetzen", "Construire"],
  "settings.betterT3.preview.agent.improved": [
    "Prompt improved",
    "Prompt verbessert",
    "Prompt amélioré",
  ],
  "settings.betterT3.preview.agent.workflow": ["Workflow", "Workflow", "Flux de travail"],
  "settings.betterT3.preview.agent.coordinated": ["Coordinated", "Koordiniert", "Coordonné"],
  "settings.betterT3.preview.agent.agent": ["Agent", "Agent", "Agent"],
  "settings.betterT3.preview.agent.planner": ["Planner", "Planer", "Planificateur"],
  "settings.betterT3.preview.agent.implementer": ["Implementer", "Umsetzungsagent", "Exécutant"],
  "settings.betterT3.preview.agent.reviewer": ["Reviewer", "Reviewer", "Réviseur"],
  "settings.betterT3.preview.agent.reasoning": [
    "Reasoning visible",
    "Reasoning sichtbar",
    "Raisonnement visible",
  ],
  "settings.betterT3.preview.chat.title": [
    "Chat and layout preview",
    "Vorschau für Chat und Layout",
    "Aperçu du chat et de la mise en page",
  ],
  "settings.betterT3.preview.chat.description": [
    "Shows the active presentation, sidebar, card deck, and motion settings.",
    "Zeigt Darstellung, Sidebar, Kartenstapel und Bewegungseinstellungen.",
    "Affiche la présentation, la barre latérale, les cartes et les animations.",
  ],
  "settings.betterT3.preview.chat.response": [
    "Here is the live response",
    "Hier ist die Live-Antwort",
    "Voici la réponse en direct",
  ],
  "settings.betterT3.preview.chat.mcp": ["MCP", "MCP", "MCP"],
  "settings.betterT3.preview.chat.git": ["Git", "Git", "Git"],
  "settings.betterT3.preview.chat.prompt": ["Type a prompt", "Prompt eingeben", "Saisir un prompt"],
  "settings.betterT3.availability.available": ["Available", "Verfügbar", "Disponible"],
  "settings.betterT3.availability.unavailable": [
    "Unavailable in the current environment",
    "In der aktuellen Umgebung nicht verfügbar",
    "Indisponible dans l’environnement actuel",
  ],
  "settings.betterT3.availability.blocked": [
    "Enable the required feature first",
    "Zuerst die erforderliche Funktion aktivieren",
    "Activez d’abord la fonction requise",
  ],
  "settings.betterT3.availability.unsupported": [
    "Unsupported by this client or environment",
    "Von diesem Client oder dieser Umgebung nicht unterstützt",
    "Non pris en charge par ce client ou cet environnement",
  ],
  "settings.betterT3.control.configure": ["Configure", "Konfigurieren", "Configurer"],
  "settings.betterT3.control.open": ["Open", "Öffnen", "Ouvrir"],
  "settings.betterT3.control.statusEnabled": ["Enabled", "Aktiviert", "Activé"],
  "settings.betterT3.control.statusDisabled": ["Disabled", "Deaktiviert", "Désactivé"],
  "settings.betterT3.status.remoteReady": [
    "Remote ready",
    "Remote bereit",
    "Prêt pour l’accès à distance",
  ],
  "settings.betterT3.status.remoteLimited": [
    "Remote context limited",
    "Remote-Kontext eingeschränkt",
    "Contexte distant limité",
  ],
  "settings.betterT3.status.analyticsRemoved": [
    "Outbound analytics removed",
    "Ausgehende Analytics entfernt",
    "Analyse sortante supprimée",
  ],
  "settings.betterT3.status.lifecycleHealthy": [
    "Lifecycle healthy",
    "Lifecycle fehlerfrei",
    "Cycle de vie opérationnel",
  ],
  "settings.betterT3.status.lifecycleReconnecting": [
    "Reconnecting",
    "Verbindung wird wiederhergestellt",
    "Reconnexion en cours",
  ],
  "settings.betterT3.status.lifecycleAttention": [
    "Needs attention",
    "Eingriff erforderlich",
    "Nécessite votre attention",
  ],
  "settings.betterT3.status.supported": ["Supported", "Unterstützt", "Pris en charge"],
  "settings.betterT3.status.compatibilityCurrent": [
    "Current capabilities",
    "Aktuelle Funktionen",
    "Fonctionnalités actuelles",
  ],
  "settings.betterT3.status.compatibilityLimited": [
    "Limited by server version",
    "Durch Serverversion eingeschränkt",
    "Limité par la version du serveur",
  ],
  "settings.betterT3.status.unknown": ["Unknown", "Unbekannt", "Inconnu"],
  "settings.betterT3.status.unsupported": [
    "Unsupported",
    "Nicht unterstützt",
    "Non pris en charge",
  ],
  "settings.betterT3.status.projectRequired": [
    "Select a project",
    "Projekt auswählen",
    "Sélectionner un projet",
  ],
  "settings.betterT3.status.loading": ["Loading…", "Wird geladen…", "Chargement…"],
  "settings.betterT3.status.mcpRuntime": [
    "{{connected}}/{{runtime}} connected · {{attention}} need attention · {{authRequired}} need authentication",
    "{{connected}}/{{runtime}} verbunden · {{attention}} benötigen Aufmerksamkeit · {{authRequired}} benötigen Authentifizierung",
    "{{connected}}/{{runtime}} connectés · {{attention}} nécessitent une attention · {{authRequired}} nécessitent une authentification",
  ],
  "settings.betterT3.status.mcpConfiguredCount": [
    "{{status}} · {{count}} configured",
    "{{status}} · {{count}} konfiguriert",
    "{{status}} · {{count}} configurés",
  ],
  "settings.betterT3.status.skillsLoaded": [
    "{{enabled}}/{{total}} enabled",
    "{{enabled}}/{{total}} aktiviert",
    "{{enabled}}/{{total}} activés",
  ],
  "settings.betterT3.status.skillsAdvertised": [
    "{{enabled}}/{{total}} advertised enabled · loaded status unknown",
    "{{enabled}}/{{total}} angekündigt aktiviert · Ladestatus unbekannt",
    "{{enabled}}/{{total}} annoncés activés · état de chargement inconnu",
  ],
  "settings.betterT3.status.skillsSummary": [
    "{{advertised}} advertised · {{loaded}} loaded",
    "{{advertised}} angekündigt · {{loaded}} geladen",
    "{{advertised}} annoncés · {{loaded}} chargés",
  ],
  "settings.betterT3.status.compatibilityCount": [
    "{{status}} · {{supported}}/{{total}} supported",
    "{{status}} · {{supported}}/{{total}} unterstützt",
    "{{status}} · {{supported}}/{{total}} pris en charge",
  ],
  "settings.betterT3.status.knowledgeProgress": [
    "{{processed}}/{{total}} files · {{queued}} semantic queued",
    "{{processed}}/{{total}} Dateien · {{queued}} semantisch vorgemerkt",
    "{{processed}}/{{total}} fichiers · {{queued}} sémantiques en attente",
  ],
  "settings.betterT3.providers.additionalHeading": [
    "Additional Better T3 providers",
    "Zusätzliche Better-T3-Provider",
    "Fournisseurs Better T3 supplémentaires",
  ],
  "settings.betterT3.initialization.clean": [
    "Defaults for this new installation",
    "Standardwerte für diese neue Installation",
    "Valeurs par défaut de cette nouvelle installation",
  ],
  "settings.betterT3.initialization.existing": [
    "Existing behavior preserved",
    "Bestehendes Verhalten beibehalten",
    "Comportement existant conservé",
  ],
  "settings.betterT3.value.automatic": ["Automatic", "Automatisch", "Automatique"],
  "settings.betterT3.value.unavailable": ["Unavailable", "Nicht verfügbar", "Indisponible"],
  "settings.betterT3.value.current": ["Current", "Aktuell", "Actuel"],
  "settings.betterT3.value.classic": ["Classic", "Klassisch", "Classique"],
  "settings.betterT3.value.updated": [
    "Recently updated",
    "Zuletzt aktualisiert",
    "Mis à jour récemment",
  ],
  "settings.betterT3.value.created": ["Recently created", "Zuletzt erstellt", "Créé récemment"],
  "settings.betterT3.value.manual": ["Manual", "Manuell", "Manuel"],
  "settings.betterT3.value.nativeLanguage": [
    "Native language",
    "Originalsprache",
    "Langue d'origine",
  ],
  "settings.betterT3.value.english": ["English", "Englisch", "Anglais"],
  "settings.betterT3.value.off": ["Off", "Aus", "Désactivé"],
  "settings.betterT3.value.lite": ["Lite", "Leicht", "Léger"],
  "settings.betterT3.value.full": ["Full", "Voll", "Complet"],
  "settings.betterT3.value.ultra": ["Ultra", "Ultra", "Ultra"],
  "settings.betterT3.value.days": [
    { one: "{{count}} day", other: "{{count}} days" },
    { one: "{{count}} Tag", other: "{{count}} Tage" },
    { one: "{{count}} jour", other: "{{count}} jours" },
  ],
  "settings.betterT3.value.settleOnMerge": [
    "Settle after merge",
    "Nach dem Zusammenführen ablegen",
    "Classer après la fusion",
  ],
  "settings.betterT3.value.projectSort": [
    "Project sorting",
    "Projektsortierung",
    "Tri des projets",
  ],
  "settings.betterT3.value.threadSort": [
    "Thread sorting",
    "Chat-Sortierung",
    "Tri des discussions",
  ],
  "settings.betterT3.value.pauseAll": [
    "Pause all indexing",
    "Alle Indexierungen pausieren",
    "Suspendre toute l'indexation",
  ],
  "settings.betterT3.value.resumeAll": [
    "Resume all indexing",
    "Alle Indexierungen fortsetzen",
    "Reprendre toute l'indexation",
  ],
  "settings.betterT3.value.projectCount": [
    { one: "{{count}} project", other: "{{count}} projects" },
    { one: "{{count}} Projekt", other: "{{count}} Projekte" },
    { one: "{{count}} projet", other: "{{count}} projets" },
  ],
  "settings.betterT3.sidebarPosition.label": [
    "Sidebar position",
    "Position der Seitenleiste",
    "Position de la barre latérale",
  ],
  "settings.betterT3.sidebarPosition.left": ["Left", "Links", "À gauche"],
  "settings.betterT3.sidebarPosition.right": ["Right", "Rechts", "À droite"],
  "settings.betterT3.mobile.transcript.title": [
    "Transcript portability",
    "Transkript-Portabilität",
    "Portabilité des transcriptions",
  ],
  "settings.betterT3.transcript.title": [
    "Transcript portability",
    "Transkript-Portabilität",
    "Portabilité des transcriptions",
  ],
  "settings.betterT3.transcript.description": [
    "Select a thread before copying its complete Markdown transcript.",
    "Wähle einen Chat aus, bevor du sein vollständiges Markdown-Transkript kopierst.",
    "Sélectionnez une discussion avant de copier sa transcription Markdown complète.",
  ],
  "settings.betterT3.transcript.selectThread": [
    "Select a thread",
    "Chat auswählen",
    "Sélectionner une discussion",
  ],
  "settings.betterT3.transcript.empty": [
    "No active threads are available from a connected, compatible environment.",
    "Keine aktiven Chats aus einer verbundenen, kompatiblen Umgebung verfügbar.",
    "Aucune discussion active n’est disponible depuis un environnement connecté et compatible.",
  ],
  "settings.betterT3.knowledgeOwner.selectThread": [
    "Select a thread",
    "Chat auswählen",
    "Sélectionner une discussion",
  ],
  "settings.betterT3.knowledgeOwner.empty": [
    "No active threads are available in this environment.",
    "In dieser Umgebung sind keine aktiven Chats verfügbar.",
    "Aucune discussion active n’est disponible dans cet environnement.",
  ],
  "settings.betterT3.knowledgeOwner.open": [
    "Open Knowledge Graph",
    "Wissensgraph öffnen",
    "Ouvrir le graphe de connaissances",
  ],
  "settings.betterT3.mobile.transcript.description": [
    "Select a thread before copying its complete Markdown transcript.",
    "Wähle einen Chat aus, bevor du sein vollständiges Markdown-Transkript kopierst.",
    "Sélectionnez une discussion avant de copier sa transcription Markdown complète.",
  ],
  "settings.betterT3.mobile.transcript.selectThread": [
    "Select a thread",
    "Chat auswählen",
    "Sélectionner une discussion",
  ],
  "settings.betterT3.mobile.transcript.empty": [
    "No active threads are available in this environment.",
    "In dieser Umgebung sind keine aktiven Chats verfügbar.",
    "Aucune discussion active n’est disponible dans cet environnement.",
  ],
  "settings.betterT3.mobile.transcript.unsupported": [
    "Transcript export is not supported by this environment.",
    "Diese Umgebung unterstützt keinen Transkript-Export.",
    "Cet environnement ne prend pas en charge l’exportation des transcriptions.",
  ],
  "settings.betterT3.mobile.transcript.copy": [
    "Copy selected transcript",
    "Ausgewähltes Transkript kopieren",
    "Copier la transcription sélectionnée",
  ],
  "settings.betterT3.mobile.transcript.copying": [
    "Copying transcript…",
    "Transkript wird kopiert…",
    "Copie de la transcription…",
  ],
  "settings.betterT3.mobile.transcript.copiedTitle": [
    "Transcript copied",
    "Transkript kopiert",
    "Transcription copiée",
  ],
  "settings.betterT3.mobile.transcript.copiedDescription": [
    "The complete Markdown transcript is now on your clipboard.",
    "Das vollständige Markdown-Transkript befindet sich jetzt in der Zwischenablage.",
    "La transcription Markdown complète se trouve maintenant dans le presse-papiers.",
  ],
  "settings.betterT3.mobile.transcript.failedTitle": [
    "Could not copy transcript",
    "Transkript konnte nicht kopiert werden",
    "Impossible de copier la transcription",
  ],
  "settings.betterT3.mobile.transcript.failedDescription": [
    "Transcript export failed: {{message}}",
    "Transkript-Export fehlgeschlagen: {{message}}",
    "Échec de l’exportation de la transcription : {{message}}",
  ],
  "settings.betterT3.mobile.transcript.clipboardFailed": [
    "The clipboard could not be updated.",
    "Die Zwischenablage konnte nicht aktualisiert werden.",
    "Le presse-papiers n’a pas pu être mis à jour.",
  ],
  "settings.betterT3.mobile.diagnostics.title": [
    "Resource diagnostics",
    "Ressourcendiagnose",
    "Diagnostic des ressources",
  ],
  "settings.betterT3.mobile.diagnostics.description": [
    "Read-only resource-protection status for the selected environment.",
    "Schreibgeschützter Ressourcenschutz-Status für die ausgewählte Umgebung.",
    "État en lecture seule de la protection des ressources pour l’environnement sélectionné.",
  ],
  "settings.betterT3.mobile.diagnostics.unsupported": [
    "Resource diagnostics are not supported by this environment.",
    "Diese Umgebung unterstützt keine Ressourcendiagnose.",
    "Cet environnement ne prend pas en charge le diagnostic des ressources.",
  ],
  "settings.betterT3.mobile.diagnostics.loading": [
    "Loading resource status…",
    "Ressourcenstatus wird geladen…",
    "Chargement de l’état des ressources…",
  ],
  "settings.betterT3.mobile.diagnostics.state": [
    "Protection state",
    "Schutzstatus",
    "État de protection",
  ],
  "settings.betterT3.mobile.diagnostics.memory": ["Memory", "Arbeitsspeicher", "Mémoire"],
  "settings.betterT3.mobile.diagnostics.memoryValue": [
    "{{available}} available of {{total}}",
    "{{available}} von {{total}} verfügbar",
    "{{available}} disponibles sur {{total}}",
  ],
  "settings.betterT3.mobile.diagnostics.reserved": [
    "Reserved for agents",
    "Für Agents reserviert",
    "Réservée aux agents",
  ],
  "settings.betterT3.mobile.diagnostics.coreReserve": [
    "Core reserve",
    "Core-Reserve",
    "Réserve principale",
  ],
  "settings.betterT3.mobile.diagnostics.waitingStarts": [
    "Waiting starts",
    "Wartende Starts",
    "Démarrages en attente",
  ],
  "settings.betterT3.mobile.diagnostics.state.normal": ["Normal", "Normal", "Normal"],
  "settings.betterT3.mobile.diagnostics.state.waiting": ["Waiting", "Wartend", "En attente"],
  "settings.betterT3.mobile.diagnostics.state.throttled": ["Throttled", "Gedrosselt", "Limité"],
  "settings.betterT3.mobile.diagnostics.state.recovering": [
    "Recovering",
    "Wiederherstellung",
    "Récupération",
  ],
  "settings.betterT3.mobile.diagnostics.state.unavailable": [
    "Unavailable",
    "Nicht verfügbar",
    "Indisponible",
  ],
});

type FeatureLabel = readonly [en: string, de: string, fr: string];

const featureLabels = {
  "agent.fetch": ["Fetch", "Fetch", "Fetch"],
  "agent.fetchModel": ["Fetch model", "Fetch-Modell", "Modèle Fetch"],
  "agent.parallelPlanImplementation": [
    "Parallel plan implementation",
    "Parallele Planumsetzung",
    "Implémentation parallèle du plan",
  ],
  "agent.parallelPlanReviewer": [
    "Parallel plan reviewer",
    "Prüfmodell für parallele Pläne",
    "Réviseur du plan parallèle",
  ],
  "agent.autoReasoningModel": [
    "Auto Reasoning decision model",
    "Entscheidungsmodell für Auto Reasoning",
    "Modèle de décision du raisonnement automatique",
  ],
  "agent.planMode": ["Plan Mode", "Planmodus", "Mode Plan"],
  "agent.deepThinking": ["Deep Thinking", "Tiefes Denken", "Réflexion approfondie"],
  "agent.cavemanMode": ["Caveman Mode", "Caveman-Modus", "Mode Caveman"],
  "agent.promptImprovement": [
    "Prompt improvement",
    "Prompt-Verbesserung",
    "Amélioration du prompt",
  ],
  "agent.expandedComposerControls": [
    "Expanded composer controls",
    "Erweiterte Eingabesteuerung",
    "Commandes de saisie étendues",
  ],
  "agent.reasoningVisibility": [
    "Reasoning visibility",
    "Sichtbarkeit der Begründung",
    "Visibilité du raisonnement",
  ],
  "agent.generalSubagents": ["General subagents", "Allgemeine Subagents", "Sous-agents généraux"],
  "agent.projectCoordination": [
    "Project-agent coordination",
    "Projekt-Agenten-Koordination",
    "Coordination des agents du projet",
  ],
  "chat.workspaceCardDeck": [
    "Workspace card deck",
    "Workspace-Kartendeck",
    "Jeu de cartes de l’espace de travail",
  ],
  "chat.cardMorphing": ["Card morphing", "Karten-Morphing", "Morphing des cartes"],
  "chat.characterStreamingMotion": [
    "Character streaming motion",
    "Zeichen-Streaming-Animation",
    "Animation du texte diffusé",
  ],
  "chat.presentation": ["Chat presentation", "Chat-Darstellung", "Présentation de la discussion"],
  "chat.classicBubbleOnly": [
    "Plan only in the Classic bubble",
    "Plan nur in der klassischen Bubble",
    "Plan uniquement dans la bulle classique",
  ],
  "chat.classicSidebar": ["Classic sidebar", "Klassische Seitenleiste", "Barre latérale classique"],
  "chat.previewCount": ["Preview count", "Vorschauanzahl", "Nombre d’aperçus"],
  "chat.sorting": ["Chat sorting", "Chat-Sortierung", "Tri des discussions"],
  "chat.settling": ["Chat settling", "Chat-Ablage", "Classement des discussions"],
  "chat.shiftClickShowLess": [
    "Shift-click Show Less",
    "Umschalt-Klick für Weniger anzeigen",
    "Maj-clic pour afficher moins",
  ],
  "chat.draftIndicators": ["Draft indicators", "Entwurfsanzeigen", "Indicateurs de brouillon"],
  "chat.sidebarPosition": [
    "Sidebar position",
    "Position der Seitenleiste",
    "Position de la barre latérale",
  ],
  "workspace.gitWorkbench": ["Git workbench", "Git-Werkbank", "Atelier Git"],
  "workspace.checkpoints": [
    "Checkpoint status",
    "Checkpoint-Status",
    "État des points de contrôle",
  ],
  "workspace.chatPortability": [
    "Chat portability",
    "Chat-Portabilität",
    "Portabilité des discussions",
  ],
  "voice.assemblyAi": ["AssemblyAI dictation", "AssemblyAI-Diktat", "Dictée AssemblyAI"],
  "voice.outputLanguage": [
    "Voice-output language",
    "Sprache der Sprachausgabe",
    "Langue de sortie vocale",
  ],
  "voice.transcriptPortability": [
    "Transcript portability",
    "Transkript-Portabilität",
    "Portabilité des transcriptions",
  ],
  "voice.credentials": ["Voice credentials", "Sprachzugangsdaten", "Identifiants vocaux"],
  "knowledge.graph": ["Knowledge Graph", "Wissensgraph", "Graphe de connaissances"],
  "knowledge.model": [
    "Knowledge Graph model",
    "Wissensgraph-Modell",
    "Modèle du graphe de connaissances",
  ],
  "knowledge.progress": [
    "Indexing progress",
    "Indexierungsfortschritt",
    "Progression de l’indexation",
  ],
  "knowledge.rebuild": [
    "Rebuild Knowledge Graph",
    "Wissensgraph neu aufbauen",
    "Reconstruire le graphe de connaissances",
  ],
  "knowledge.pause": ["Pause indexing", "Indexierung pausieren", "Suspendre l’indexation"],
  "knowledge.clear": [
    "Clear Knowledge Graph",
    "Wissensgraph leeren",
    "Effacer le graphe de connaissances",
  ],
  "resource.adaptiveAdmission": [
    "Adaptive admission",
    "Adaptive Zulassung",
    "Admission adaptative",
  ],
  "resource.processSuspension": [
    "OS-process suspension",
    "Betriebssystem-Prozesspausierung",
    "Suspension des processus système",
  ],
  "resource.diagnostics": [
    "Resource diagnostics",
    "Ressourcendiagnose",
    "Diagnostic des ressources",
  ],
  "integration.remoteReadiness": [
    "Remote readiness",
    "Remote-Bereitschaft",
    "Préparation à distance",
  ],
  "integration.analyticsRemoval": [
    "Analytics removal",
    "Entfernung der Analyseübertragung",
    "Suppression des analyses",
  ],
  "integration.lifecycleHealth": ["Lifecycle health", "Lifecycle-Zustand", "Santé du cycle de vie"],
  "integration.mcp": ["MCP status", "MCP-Status", "État MCP"],
  "integration.skills": ["Skills status", "Skill-Status", "État des skills"],
  "integration.compatibility": [
    "Compatibility status",
    "Kompatibilitätsstatus",
    "État de compatibilité",
  ],
} as const satisfies Readonly<Record<BetterT3FeatureId, FeatureLabel>>;

const featureDescriptionOverrides: Partial<Record<BetterT3FeatureId, FeatureLabel>> = {
  "agent.autoReasoningModel": [
    "Choose the model that selects reasoning effort for Auto. Automatic uses the text-generation model.",
    "Wählt das Modell, das den Reasoning-Aufwand für Auto bestimmt. Automatisch verwendet das Textgenerierungsmodell.",
    "Choisissez le modèle qui détermine l’effort de raisonnement pour Auto. Automatique utilise le modèle de génération de texte.",
  ],
  "agent.planMode": [
    "Start agent work in planning mode so it proposes a plan before changing files.",
    "Startet Agentenarbeit im Planmodus, damit vor Dateiänderungen zuerst ein Plan vorgeschlagen wird.",
    "Démarre le travail de l’agent en mode Plan afin de proposer un plan avant toute modification de fichiers.",
  ],
  "agent.generalSubagents": [
    "Allow the agent to delegate focused work to parallel subagents and show their progress.",
    "Erlaubt dem Agenten, fokussierte Aufgaben an parallele Subagents zu delegieren und ihren Fortschritt anzuzeigen.",
    "Permet à l’agent de déléguer des tâches ciblées à des sous-agents parallèles et d’afficher leur progression.",
  ],
  "agent.reasoningVisibility": [
    "Show the agent’s reasoning summary in chat while it works on the request.",
    "Zeigt während der Bearbeitung eine Zusammenfassung der Begründung direkt im Chat an.",
    "Affiche dans la discussion un résumé du raisonnement de l’agent pendant le traitement de la demande.",
  ],
  "chat.sidebarPosition": [
    "Move project navigation and its controls to the left or right side.",
    "Verschiebt Projektnavigation und Bedienelemente auf die linke oder rechte Seite.",
    "Déplace la navigation du projet et ses commandes vers le côté gauche ou droit.",
  ],
  "chat.presentation": [
    "Choose between the current grouped chat layout and the classic transcript view.",
    "Wechselt zwischen der aktuellen gruppierten Chatansicht und der klassischen Transkriptansicht.",
    "Choisit entre la présentation groupée actuelle et la vue classique de la transcription.",
  ],
  "chat.classicBubbleOnly": [
    "Hide the duplicate plan overview from the Classic transcript while keeping the blue composer bubble.",
    "Blendet die doppelte Planübersicht im klassischen Transkript aus und behält die blaue Composer-Bubble.",
    "Masque l’aperçu du plan en double dans la transcription classique tout en conservant la bulle bleue du compositeur.",
  ],
  "chat.workspaceCardDeck": [
    "Stack Chat, MCP, and Git as quick-switch cards around the composer.",
    "Stapelt Chat, MCP und Git als schnell wechselbare Karten um das Eingabefeld.",
    "Empile Chat, MCP et Git sous forme de cartes accessibles rapidement autour de la zone de saisie.",
  ],
};

export type BetterT3FeatureMessageKey = `betterT3.${BetterT3FeatureId}.${"label" | "description"}`;

function featureDescription(
  language: InterfaceCatalogLanguage,
  controlKind: BetterT3FeatureControlKind,
  label: string,
): string {
  const descriptions = {
    en: {
      switch: `Enable or disable ${label}.`,
      selector: `Choose the setting used for ${label}.`,
      action: `Open the controls for ${label}.`,
      link: `Open the owning settings for ${label}.`,
      "status-only": `View the current status of ${label}.`,
    },
    de: {
      switch: `${label} ein- oder ausschalten.`,
      selector: `Die Einstellung für ${label} auswählen.`,
      action: `Die Steuerung für ${label} öffnen.`,
      link: `Die zuständigen Einstellungen für ${label} öffnen.`,
      "status-only": `Den aktuellen Status von ${label} anzeigen.`,
    },
    fr: {
      switch: `Activer ou désactiver ${label}.`,
      selector: `Choisir le réglage utilisé pour ${label}.`,
      action: `Ouvrir les commandes de ${label}.`,
      link: `Ouvrir les réglages responsables de ${label}.`,
      "status-only": `Afficher l’état actuel de ${label}.`,
    },
  } as const;
  return descriptions[language][controlKind];
}

function buildFeatureCatalog(): LocalizedInterfaceCatalog<BetterT3FeatureMessageKey> {
  const messages = {
    en: {} as Record<BetterT3FeatureMessageKey, InterfaceMessageTemplate>,
    de: {} as Record<BetterT3FeatureMessageKey, InterfaceMessageTemplate>,
    fr: {} as Record<BetterT3FeatureMessageKey, InterfaceMessageTemplate>,
  };
  const keys: BetterT3FeatureMessageKey[] = [];
  for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
    const labelKey = `betterT3.${descriptor.id}.label` as const;
    const descriptionKey = `betterT3.${descriptor.id}.description` as const;
    keys.push(labelKey, descriptionKey);
    for (const [index, language] of ["en", "de", "fr"].entries()) {
      const label = featureLabels[descriptor.id][index]!;
      messages[language as InterfaceCatalogLanguage][labelKey] = label;
      messages[language as InterfaceCatalogLanguage][descriptionKey] =
        featureDescriptionOverrides[descriptor.id]?.[index] ??
        featureDescription(language as InterfaceCatalogLanguage, descriptor.controlKind, label);
    }
  }
  return { keys: Object.freeze(keys), messages };
}

const featureCatalog = buildFeatureCatalog();

export type BetterT3SettingsMessageKey = (typeof betterT3SettingsCatalog.keys)[number];
export type BetterT3InterfaceMessageKey = BetterT3SettingsMessageKey | BetterT3FeatureMessageKey;

export const betterT3InterfaceCatalog: LocalizedInterfaceCatalog<BetterT3InterfaceMessageKey> = {
  keys: Object.freeze([...betterT3SettingsCatalog.keys, ...featureCatalog.keys]),
  messages: {
    en: { ...betterT3SettingsCatalog.messages.en, ...featureCatalog.messages.en },
    de: { ...betterT3SettingsCatalog.messages.de, ...featureCatalog.messages.de },
    fr: { ...betterT3SettingsCatalog.messages.fr, ...featureCatalog.messages.fr },
  },
};
