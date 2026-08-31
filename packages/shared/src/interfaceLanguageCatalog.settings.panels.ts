import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const settingsPanelsInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "settings.panels.update.trackChangeFailed": [
    "Could not change update track",
    "Update-Kanal konnte nicht geändert werden",
    "Impossible de changer le canal de mise à jour",
  ],
  "settings.panels.update.trackChangeError": [
    "Update track change failed.",
    "Änderung des Update-Kanals fehlgeschlagen.",
    "Échec du changement de canal de mise à jour.",
  ],
  "settings.panels.update.downloadFailed": [
    "Could not download update",
    "Update konnte nicht heruntergeladen werden",
    "Impossible de télécharger la mise à jour",
  ],
  "settings.panels.update.downloadError": [
    "Download failed.",
    "Download fehlgeschlagen.",
    "Échec du téléchargement.",
  ],
  "settings.panels.update.confirmFailed": [
    "Could not confirm update",
    "Update konnte nicht bestätigt werden",
    "Impossible de confirmer la mise à jour",
  ],
  "settings.panels.update.confirmError": [
    "Update confirmation failed.",
    "Update-Bestätigung fehlgeschlagen.",
    "Échec de la confirmation de la mise à jour.",
  ],
  "settings.panels.update.installFailed": [
    "Could not install update",
    "Update konnte nicht installiert werden",
    "Impossible d’installer la mise à jour",
  ],
  "settings.panels.update.installError": [
    "Install failed.",
    "Installation fehlgeschlagen.",
    "Échec de l’installation.",
  ],
  "settings.panels.update.checkFailed": [
    "Could not check for updates",
    "Updates konnten nicht geprüft werden",
    "Impossible de rechercher des mises à jour",
  ],
  "settings.panels.update.checkError": [
    "Update check failed.",
    "Update-Prüfung fehlgeschlagen.",
    "Échec de la recherche de mises à jour.",
  ],
  "settings.panels.update.unavailable": [
    "Automatic updates are not available in this build.",
    "Automatische Updates sind in diesem Build nicht verfügbar.",
    "Les mises à jour automatiques ne sont pas disponibles dans cette version.",
  ],
  "settings.panels.update.download": ["Download", "Herunterladen", "Télécharger"],
  "settings.panels.update.install": ["Install", "Installieren", "Installer"],
  "settings.panels.update.checking": ["Checking…", "Wird geprüft…", "Vérification…"],
  "settings.panels.update.downloading": [
    "Downloading…",
    "Wird heruntergeladen…",
    "Téléchargement…",
  ],
  "settings.panels.update.upToDate": ["Up to Date", "Aktuell", "À jour"],
  "settings.panels.update.check": [
    "Check for Updates",
    "Nach Updates suchen",
    "Rechercher des mises à jour",
  ],
  "settings.panels.update.available": [
    "Update available.",
    "Update verfügbar.",
    "Mise à jour disponible.",
  ],
  "settings.panels.update.stable": ["Stable", "Stable", "Stable"],
  "settings.panels.update.nightly": ["Nightly", "Nightly", "Nightly"],
  "settings.panels.update.latest": ["Latest", "Neueste", "Dernière"],
  "settings.panels.restoreThemeFailed": [
    "Couldn’t restore theme settings",
    "Theme-Einstellungen konnten nicht wiederhergestellt werden",
    "Impossible de restaurer les réglages du thème",
  ],
  "settings.panels.restore.followSystem": [
    "Follow system",
    "Systemeinstellung folgen",
    "Suivre le système",
  ],
  "settings.panels.restore.themeMix": ["Theme mix", "Theme-Mix", "Mélange de thèmes"],
  "settings.panels.restore.confirmTitle": [
    "Restore default settings?",
    "Standardeinstellungen wiederherstellen?",
    "Restaurer les réglages par défaut ?",
  ],
  "settings.panels.restore.confirmDescription": [
    "This will reset: {{settings}}.",
    "Folgende Einstellungen werden zurückgesetzt: {{settings}}.",
    "Les réglages suivants seront réinitialisés : {{settings}}.",
  ],
  "settings.panels.tryAgain": ["Try again.", "Versuche es erneut.", "Réessayez."],
  "settings.panels.background.intro": [
    "Tune the shared power policy and the background intervals that feed it.",
    "Passe die gemeinsame Energierichtlinie und die zugehörigen Hintergrundintervalle an.",
    "Ajustez la politique énergétique partagée et les intervalles d’arrière-plan qui l’alimentent.",
  ],
  "settings.panels.background.sharedDescription": [
    "Controls whether background work may run after a subscribed interval fires.",
    "Steuert, ob Hintergrundarbeit nach Ablauf eines abonnierten Intervalls ausgeführt werden darf.",
    "Détermine si le travail en arrière-plan peut s’exécuter après le déclenchement d’un intervalle suivi.",
  ],
  "settings.panels.background.sharedAria": [
    "Shared background policy",
    "Gemeinsame Hintergrundrichtlinie",
    "Politique d’arrière-plan partagée",
  ],
  "settings.panels.background.gitDescription": [
    "Refresh remote branch status in the background.",
    "Aktualisiert den Status entfernter Branches im Hintergrund.",
    "Actualise l’état des branches distantes en arrière-plan.",
  ],
  "settings.panels.background.providerDescription": [
    "Refresh provider availability, versions, auth state, and model metadata.",
    "Aktualisiert Verfügbarkeit, Versionen, Authentifizierungsstatus und Modellmetadaten der Provider.",
    "Actualise la disponibilité, les versions, l’authentification et les métadonnées de modèle des fournisseurs.",
  ],
  "settings.panels.background.hostDescription": [
    "Poll host power state while clients are active.",
    "Fragt den Energiestatus des Hosts ab, solange Clients aktiv sind.",
    "Interroge l’état d’alimentation de l’hôte lorsque des clients sont actifs.",
  ],
  "settings.panels.background.idleDescription": [
    "Poll host power state when no foreground client is active.",
    "Fragt den Energiestatus des Hosts ab, wenn kein Client im Vordergrund aktiv ist.",
    "Interroge l’état d’alimentation de l’hôte lorsqu’aucun client n’est actif au premier plan.",
  ],
  "settings.panels.background.resetAll": ["Reset all", "Alles zurücksetzen", "Tout réinitialiser"],
  "settings.panels.background.profile.balanced": ["Balanced", "Ausgewogen", "Équilibré"],
  "settings.panels.background.profile.performance": ["Performance", "Leistung", "Performances"],
  "settings.panels.background.profile.batterySaver": [
    "Battery saver",
    "Energiesparen",
    "Économie d’énergie",
  ],
  "settings.panels.background.profile.advanced": ["Advanced", "Erweitert", "Avancé"],
  "settings.panels.background.profile.balancedDescription": [
    "Pauses background probes when clients are idle, the host is locked, or low power mode is active.",
    "Pausiert Hintergrundprüfungen bei inaktiven Clients, gesperrtem Host oder aktivem Energiesparmodus.",
    "Suspend les vérifications en arrière-plan lorsque les clients sont inactifs, que l’hôte est verrouillé ou que le mode économie d’énergie est actif.",
  ],
  "settings.panels.background.profile.performanceDescription": [
    "Allows scoped background probes while any subscribed client remains connected.",
    "Erlaubt begrenzte Hintergrundprüfungen, solange ein abonnierter Client verbunden ist.",
    "Autorise les vérifications ciblées en arrière-plan tant qu’un client abonné reste connecté.",
  ],
  "settings.panels.background.profile.batterySaverDescription": [
    "Also pauses background probes when the host or client is on battery.",
    "Pausiert Hintergrundprüfungen zusätzlich, wenn Host oder Client im Akkubetrieb sind.",
    "Suspend aussi les vérifications en arrière-plan lorsque l’hôte ou le client fonctionne sur batterie.",
  ],
  "settings.panels.background.profile.advancedDescription": [
    "Uses custom background intervals with the selected shared power policy.",
    "Verwendet benutzerdefinierte Hintergrundintervalle mit der ausgewählten gemeinsamen Energierichtlinie.",
    "Utilise des intervalles d’arrière-plan personnalisés avec la politique énergétique partagée sélectionnée.",
  ],
  "settings.panels.background.profile.advancedCurrentPolicy": [
    "Uses custom background intervals with the selected shared power policy. Current shared policy: {{profile}}.",
    "Verwendet benutzerdefinierte Hintergrundintervalle mit der ausgewählten gemeinsamen Energierichtlinie. Aktuelle gemeinsame Richtlinie: {{profile}}.",
    "Utilise des intervalles d’arrière-plan personnalisés avec la politique énergétique partagée sélectionnée. Politique actuelle : {{profile}}.",
  ],
  "settings.panels.background.pause.hostLocked": [
    "Pause when host is locked",
    "Bei gesperrtem Host pausieren",
    "Suspendre lorsque l’hôte est verrouillé",
  ],
  "settings.panels.background.pause.hostLowPower": [
    "Pause on host low power",
    "Bei Energiesparmodus des Hosts pausieren",
    "Suspendre lorsque l’hôte est en mode économie d’énergie",
  ],
  "settings.panels.background.pause.clientLowPower": [
    "Pause on client low power",
    "Bei Energiesparmodus des Clients pausieren",
    "Suspendre lorsque le client est en mode économie d’énergie",
  ],
  "settings.panels.background.pause.onBattery": [
    "Pause on battery",
    "Im Akkubetrieb pausieren",
    "Suspendre sur batterie",
  ],
  "settings.panels.background.gateDescription": [
    "This shared policy gates background work such as Git refreshes and provider health probes after their individual intervals elapse.",
    "Diese gemeinsame Richtlinie steuert Hintergrundarbeit wie Git-Aktualisierungen und Provider-Prüfungen nach Ablauf ihrer jeweiligen Intervalle.",
    "Cette politique partagée contrôle les tâches en arrière-plan comme les actualisations Git et les vérifications des fournisseurs après leurs intervalles respectifs.",
  ],
  "settings.panels.background.advancedAria": [
    "Configure advanced background activity",
    "Erweiterte Hintergrundaktivität konfigurieren",
    "Configurer l’activité avancée en arrière-plan",
  ],
  "settings.panels.appearance.environment.artwork": ["Artwork", "Grafik", "Illustration"],
  "settings.panels.appearance.environment.pill": [
    "Version pill",
    "Versionsanzeige",
    "Pastille de version",
  ],
  "settings.panels.appearance.timestamp.system": [
    "System default",
    "Systemstandard",
    "Valeur système",
  ],
  "settings.panels.appearance.timestamp.twelveHour": ["12-hour", "12 Stunden", "12 heures"],
  "settings.panels.appearance.timestamp.twentyFourHour": ["24-hour", "24 Stunden", "24 heures"],
  "settings.panels.appearance.systemMonospace": [
    "System monospace",
    "System-Monospace",
    "Police à chasse fixe du système",
  ],
  "settings.panels.appearance.interfaceFontSize": [
    "Interface font size",
    "Schriftgröße der Oberfläche",
    "Taille de police de l’interface",
  ],
  "settings.panels.appearance.promptFontSize": [
    "Prompt font size",
    "Prompt-Schriftgröße",
    "Taille de police des prompts",
  ],
  "settings.panels.appearance.codeFontSize": [
    "Code font size",
    "Code-Schriftgröße",
    "Taille de police du code",
  ],
  "settings.panels.appearance.terminalFontSize": [
    "Terminal font size",
    "Terminal-Schriftgröße",
    "Taille de police du terminal",
  ],
  "settings.panels.appearance.fontFamilyAria": [
    "{{title}} family",
    "Schriftfamilie {{title}}",
    "Famille de police {{title}}",
  ],
  "settings.panels.appearance.advanced": ["Advanced", "Erweitert", "Avancé"],
  "settings.panels.appearance.pixels": ["px", "px", "px"],
  "settings.panels.general.local": ["Local", "Lokal", "Local"],
  "settings.panels.general.newWorktree": [
    "New worktree",
    "Neuer Worktree",
    "Nouvel arbre de travail",
  ],
  "settings.panels.legacy.title": [
    "Legacy features",
    "Legacy-Funktionen",
    "Fonctionnalités héritées",
  ],
  "settings.panels.legacy.tokenConfirmTitle": [
    "Turn on token-by-token output?",
    "Tokenweise Ausgabe aktivieren?",
    "Activer la sortie jeton par jeton ?",
  ],
  "settings.panels.legacy.tokenConfirmDescription": [
    "It is significantly slower than the default buffered output and hurts the reading experience. This switch exists only for backwards compatibility.",
    "Sie ist deutlich langsamer als die standardmäßig gepufferte Ausgabe und beeinträchtigt das Lesen. Dieser Schalter dient nur der Abwärtskompatibilität.",
    "Elle est nettement plus lente que la sortie mise en mémoire tampon par défaut et nuit à la lecture. Ce réglage existe uniquement pour la rétrocompatibilité.",
  ],
  "settings.panels.about.viewDiagnostics": [
    "View diagnostics",
    "Diagnose anzeigen",
    "Afficher le diagnostic",
  ],
  "settings.panels.archive.unarchiveFailed": [
    "Failed to unarchive thread",
    "Chat konnte nicht dearchiviert werden",
    "Échec de la restauration de la discussion",
  ],
  "settings.panels.archive.deleteFailed": [
    "Failed to delete thread",
    "Chat konnte nicht gelöscht werden",
    "Échec de la suppression de la discussion",
  ],
  "settings.panels.archive.actionFailed": [
    "Archived thread action failed",
    "Aktion für archivierten Chat fehlgeschlagen",
    "Échec de l’action sur la discussion archivée",
  ],
  "settings.panels.archive.unexpectedError": [
    "An error occurred.",
    "Ein Fehler ist aufgetreten.",
    "Une erreur s’est produite.",
  ],
  "settings.panels.archive.loading": [
    "Loading archived threads",
    "Archivierte Chats werden geladen",
    "Chargement des discussions archivées",
  ],
  "settings.panels.archive.loadFailed": [
    "Could not load archived threads",
    "Archivierte Chats konnten nicht geladen werden",
    "Impossible de charger les discussions archivées",
  ],
  "settings.panels.archive.empty": [
    "No archived threads",
    "Keine archivierten Chats",
    "Aucune discussion archivée",
  ],
  "settings.panels.archive.checking": [
    "Checking connected environments.",
    "Verbundene Umgebungen werden geprüft.",
    "Vérification des environnements connectés.",
  ],
  "settings.panels.archive.emptyDescription": [
    "Archived threads will appear here.",
    "Archivierte Chats werden hier angezeigt.",
    "Les discussions archivées apparaîtront ici.",
  ],
  "settings.panels.archive.archivedAt": [
    "Archived {{date}}",
    "Archiviert {{date}}",
    "Archivée {{date}}",
  ],
  "settings.panels.archive.createdAt": ["Created {{date}}", "Erstellt {{date}}", "Créée {{date}}"],
});

export type SettingsPanelsInterfaceMessageKey =
  (typeof settingsPanelsInterfaceCatalog.keys)[number];
