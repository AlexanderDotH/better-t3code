import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const settingsProvidersInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "settings.providers.status.checking": [
    "Checking provider status",
    "Providerstatus wird geprüft",
    "Vérification de l’état du fournisseur",
  ],
  "settings.providers.status.waiting": [
    "Waiting for the server to report installation and authentication details.",
    "Warten auf Installations- und Authentifizierungsdetails vom Server.",
    "En attente des informations d’installation et d’authentification du serveur.",
  ],
  "settings.providers.status.disabled": ["Disabled", "Deaktiviert", "Désactivé"],
  "settings.providers.status.disabledDetail": [
    "This provider is installed but disabled for new sessions in T3 Code.",
    "Dieser Provider ist installiert, aber für neue T3-Code-Sitzungen deaktiviert.",
    "Ce fournisseur est installé, mais désactivé pour les nouvelles sessions T3 Code.",
  ],
  "settings.providers.status.notFound": ["Not found", "Nicht gefunden", "Introuvable"],
  "settings.providers.status.cliMissing": [
    "CLI not detected on PATH.",
    "CLI wurde im PATH nicht gefunden.",
    "CLI introuvable dans le PATH.",
  ],
  "settings.providers.status.authenticated": ["Authenticated", "Authentifiziert", "Authentifié"],
  "settings.providers.status.authenticatedWith": [
    "Authenticated · {{label}}",
    "Authentifiziert · {{label}}",
    "Authentifié · {{label}}",
  ],
  "settings.providers.status.notAuthenticated": [
    "Not authenticated",
    "Nicht authentifiziert",
    "Non authentifié",
  ],
  "settings.providers.status.needsAttention": [
    "Needs attention",
    "Aufmerksamkeit erforderlich",
    "Attention requise",
  ],
  "settings.providers.status.verificationFailed": [
    "The provider is installed, but the server could not fully verify it.",
    "Der Provider ist installiert, konnte vom Server aber nicht vollständig geprüft werden.",
    "Le fournisseur est installé, mais le serveur n’a pas pu le vérifier complètement.",
  ],
  "settings.providers.status.unavailable": ["Unavailable", "Nicht verfügbar", "Indisponible"],
  "settings.providers.status.startupFailed": [
    "The provider failed its startup checks.",
    "Die Startprüfungen des Providers sind fehlgeschlagen.",
    "Les vérifications de démarrage du fournisseur ont échoué.",
  ],
  "settings.providers.status.available": ["Available", "Verfügbar", "Disponible"],
  "settings.providers.status.authUnknown": [
    "Installed and ready, but authentication could not be verified.",
    "Installiert und bereit, aber die Authentifizierung konnte nicht geprüft werden.",
    "Installé et prêt, mais l’authentification n’a pas pu être vérifiée.",
  ],
  "settings.providers.update.available": [
    "Update available",
    "Update verfügbar",
    "Mise à jour disponible",
  ],
  "settings.providers.update.installVersion": [
    "Update available: install {{version}}.",
    "Update verfügbar: {{version}} installieren.",
    "Mise à jour disponible : installez {{version}}.",
  ],
  "settings.providers.update.installLatest": [
    "Update available: install the latest provider version.",
    "Update verfügbar: Neueste Provider-Version installieren.",
    "Mise à jour disponible : installez la dernière version du fournisseur.",
  ],
  "settings.providers.update.copied": [
    "{{provider}} update command copied",
    "Update-Befehl für {{provider}} kopiert",
    "Commande de mise à jour de {{provider}} copiée",
  ],
  "settings.providers.update.runTerminal": [
    "Run it in a terminal when you are ready to update.",
    "Führe ihn in einem Terminal aus, sobald du das Update starten möchtest.",
    "Exécutez-la dans un terminal lorsque vous êtes prêt à effectuer la mise à jour.",
  ],
  "settings.providers.update.copyFailed": [
    "Could not copy {{provider}} update command",
    "Update-Befehl für {{provider}} konnte nicht kopiert werden",
    "Impossible de copier la commande de mise à jour de {{provider}}",
  ],
  "settings.providers.update.viewDetails": [
    "Update available - view details",
    "Update verfügbar - Details anzeigen",
    "Mise à jour disponible - afficher les détails",
  ],
  "settings.providers.update.updating": ["Updating", "Update läuft", "Mise à jour"],
  "settings.providers.update.now": ["Update now", "Jetzt aktualisieren", "Mettre à jour"],
  "settings.providers.update.manual": [
    "or update manually using",
    "oder manuell aktualisieren mit",
    "ou mettre à jour manuellement avec",
  ],
  "settings.providers.update.copyCommand": [
    "Copy update command",
    "Update-Befehl kopieren",
    "Copier la commande de mise à jour",
  ],
  "settings.providers.auth.toggleEmail": [
    "Toggle account email visibility",
    "Sichtbarkeit der Konto-E-Mail umschalten",
    "Afficher ou masquer l’adresse e-mail du compte",
  ],
  "settings.providers.auth.revealEmail": [
    "Click to reveal email",
    "Klicken, um die E-Mail anzuzeigen",
    "Cliquer pour afficher l’adresse e-mail",
  ],
  "settings.providers.auth.hideEmail": [
    "Click to hide email",
    "Klicken, um die E-Mail auszublenden",
    "Cliquer pour masquer l’adresse e-mail",
  ],
  "settings.providers.auth.authenticatedAs": [
    "Authenticated as",
    "Authentifiziert als",
    "Authentifié en tant que",
  ],
  "settings.providers.environment.title": [
    "Environment variables",
    "Umgebungsvariablen",
    "Variables d’environnement",
  ],
  "settings.providers.environment.add": ["Add", "Hinzufügen", "Ajouter"],
  "settings.providers.environment.description": [
    "Add variables to pass API keys, base URLs, or other per-instance CLI settings.",
    "Variablen für API-Schlüssel, Basis-URLs oder andere CLI-Einstellungen dieser Instanz hinzufügen.",
    "Ajoutez des variables pour transmettre des clés API, des URL de base ou d’autres réglages CLI propres à l’instance.",
  ],
  "settings.providers.environment.variable": ["Variable", "Variable", "Variable"],
  "settings.providers.environment.namePlaceholder": [
    "VARIABLE_NAME",
    "VARIABLENNAME",
    "NOM_VARIABLE",
  ],
  "settings.providers.environment.value": ["Value", "Wert", "Valeur"],
  "settings.providers.environment.sensitive": ["Sensitive", "Vertraulich", "Sensible"],
  "settings.providers.environment.options": ["Options", "Optionen", "Options"],
  "settings.providers.environment.nameAria": [
    "Environment variable name {{index}}",
    "Name der Umgebungsvariable {{index}}",
    "Nom de la variable d’environnement {{index}}",
  ],
  "settings.providers.environment.valueAria": [
    "Environment variable value {{index}}",
    "Wert der Umgebungsvariable {{index}}",
    "Valeur de la variable d’environnement {{index}}",
  ],
  "settings.providers.environment.storedSecret": [
    "Stored secret - enter a new value to replace",
    "Gespeichertes Geheimnis - zum Ersetzen neuen Wert eingeben",
    "Secret enregistré - saisissez une nouvelle valeur pour le remplacer",
  ],
  "settings.providers.environment.markSensitive": [
    "Mark environment variable {{name}} as sensitive",
    "Umgebungsvariable {{name}} als vertraulich markieren",
    "Marquer la variable d’environnement {{name}} comme sensible",
  ],
  "settings.providers.environment.remove": [
    "Remove environment variable {{name}}",
    "Umgebungsvariable {{name}} entfernen",
    "Supprimer la variable d’environnement {{name}}",
  ],
  "settings.providers.environment.storage": [
    "Sensitive values are stored separately and are not returned to the app after saving.",
    "Vertrauliche Werte werden getrennt gespeichert und nach dem Speichern nicht an die App zurückgegeben.",
    "Les valeurs sensibles sont stockées séparément et ne sont plus renvoyées à l’application après l’enregistrement.",
  ],
  "settings.providers.instance.deleteAria": [
    "Delete provider instance {{instance}}",
    "Providerinstanz {{instance}} löschen",
    "Supprimer l’instance de fournisseur {{instance}}",
  ],
  "settings.providers.instance.delete": [
    "Delete instance",
    "Instanz löschen",
    "Supprimer l’instance",
  ],
  "settings.providers.instance.enable": [
    "Enable {{provider}}",
    "{{provider}} aktivieren",
    "Activer {{provider}}",
  ],
  "settings.providers.instance.configuration": ["Configuration", "Konfiguration", "Configuration"],
  "settings.providers.instance.models": ["Models", "Modelle", "Modèles"],
  "settings.providers.instance.displayName": ["Display name", "Anzeigename", "Nom affiché"],
  "settings.providers.instance.labelPlaceholder": [
    "Instance label",
    "Instanzbezeichnung",
    "Nom de l’instance",
  ],
  "settings.providers.instance.labelDescription": [
    "Optional label shown in the provider list.",
    "Optionale Bezeichnung in der Providerliste.",
    "Nom facultatif affiché dans la liste des fournisseurs.",
  ],
  "settings.providers.instance.accentDescription": [
    "Used to distinguish this instance in picker rails and model lists.",
    "Dient zur Unterscheidung dieser Instanz in Auswahlleisten und Modelllisten.",
    "Permet de distinguer cette instance dans les sélecteurs et les listes de modèles.",
  ],
  "settings.providers.instance.unknownDriver": [
    "This instance uses a driver ({{driver}}) that is not shipped with the current build. Configuration values are preserved but cannot be edited from this surface.",
    "Diese Instanz verwendet einen Treiber ({{driver}}), der in diesem Build nicht enthalten ist. Konfigurationswerte bleiben erhalten, können hier aber nicht bearbeitet werden.",
    "Cette instance utilise un pilote ({{driver}}) absent de cette version. Les valeurs de configuration sont conservées, mais ne peuvent pas être modifiées ici.",
  ],
  "settings.providers.models.available": [
    { one: "{{count}} model available.", other: "{{count}} models available." },
    { one: "{{count}} Modell verfügbar.", other: "{{count}} Modelle verfügbar." },
    { one: "{{count}} modèle disponible.", other: "{{count}} modèles disponibles." },
  ],
  "settings.providers.models.enterSlug": [
    "Enter a model slug.",
    "Modell-Slug eingeben.",
    "Saisissez un identifiant de modèle.",
  ],
  "settings.providers.models.builtIn": [
    "That model is already built in.",
    "Dieses Modell ist bereits integriert.",
    "Ce modèle est déjà intégré.",
  ],
  "settings.providers.models.maxLength": [
    "Model slugs must be {{count}} characters or less.",
    "Modell-Slugs dürfen höchstens {{count}} Zeichen lang sein.",
    "Les identifiants de modèle doivent comporter au maximum {{count}} caractères.",
  ],
  "settings.providers.models.alreadySaved": [
    "That custom model is already saved.",
    "Dieses benutzerdefinierte Modell ist bereits gespeichert.",
    "Ce modèle personnalisé est déjà enregistré.",
  ],
  "settings.providers.models.fastMode": ["Fast mode", "Schnellmodus", "Mode rapide"],
  "settings.providers.models.thinking": ["Thinking", "Thinking", "Réflexion"],
  "settings.providers.models.reasoning": ["Reasoning", "Reasoning", "Raisonnement"],
  "settings.providers.models.detailsAria": [
    "Details for {{model}}",
    "Details für {{model}}",
    "Détails de {{model}}",
  ],
  "settings.providers.models.hidden": ["hidden", "ausgeblendet", "masqué"],
  "settings.providers.models.custom": ["custom", "benutzerdefiniert", "personnalisé"],
  "settings.providers.models.addFavoriteAria": [
    "Add {{model}} to favorites",
    "{{model}} zu Favoriten hinzufügen",
    "Ajouter {{model}} aux favoris",
  ],
  "settings.providers.models.removeFavoriteAria": [
    "Remove {{model}} from favorites",
    "{{model}} aus Favoriten entfernen",
    "Retirer {{model}} des favoris",
  ],
  "settings.providers.models.addFavorite": [
    "Add to favorites",
    "Zu Favoriten hinzufügen",
    "Ajouter aux favoris",
  ],
  "settings.providers.models.removeFavorite": [
    "Remove from favorites",
    "Aus Favoriten entfernen",
    "Retirer des favoris",
  ],
  "settings.providers.models.moveUpAria": [
    "Move {{model}} up",
    "{{model}} nach oben verschieben",
    "Déplacer {{model}} vers le haut",
  ],
  "settings.providers.models.moveDownAria": [
    "Move {{model}} down",
    "{{model}} nach unten verschieben",
    "Déplacer {{model}} vers le bas",
  ],
  "settings.providers.models.moveUp": ["Move up", "Nach oben verschieben", "Déplacer vers le haut"],
  "settings.providers.models.moveDown": [
    "Move down",
    "Nach unten verschieben",
    "Déplacer vers le bas",
  ],
  "settings.providers.models.showAria": [
    "Show {{model}}",
    "{{model}} anzeigen",
    "Afficher {{model}}",
  ],
  "settings.providers.models.hideAria": [
    "Hide {{model}}",
    "{{model}} ausblenden",
    "Masquer {{model}}",
  ],
  "settings.providers.models.showPicker": [
    "Show in picker",
    "In der Auswahl anzeigen",
    "Afficher dans le sélecteur",
  ],
  "settings.providers.models.hidePicker": [
    "Hide from picker",
    "Aus der Auswahl ausblenden",
    "Masquer du sélecteur",
  ],
  "settings.providers.models.removeAria": [
    "Remove {{model}}",
    "{{model}} entfernen",
    "Supprimer {{model}}",
  ],
  "settings.providers.models.removeCustom": [
    "Remove custom model",
    "Benutzerdefiniertes Modell entfernen",
    "Supprimer le modèle personnalisé",
  ],
  "settings.providers.models.add": ["Add", "Hinzufügen", "Ajouter"],
  "settings.providers.panel.title": ["Providers", "Provider", "Fournisseurs"],
  "settings.providers.panel.devices": ["Devices", "Geräte", "Appareils"],
  "settings.providers.panel.primaryDevice": [
    "Primary device",
    "Primäres Gerät",
    "Appareil principal",
  ],
  "settings.providers.panel.localDevice": ["Local device", "Lokales Gerät", "Appareil local"],
  "settings.providers.panel.remoteDevice": [
    "Remote device",
    "Entferntes Gerät",
    "Appareil distant",
  ],
  "settings.providers.panel.loading": [
    "Loading provider settings",
    "Provider-Einstellungen werden geladen",
    "Chargement des réglages des fournisseurs",
  ],
  "settings.providers.panel.connectFailed": [
    "Could not connect to this device",
    "Verbindung zu diesem Gerät fehlgeschlagen",
    "Impossible de se connecter à cet appareil",
  ],
  "settings.providers.panel.unavailable": [
    "Provider settings are unavailable",
    "Provider-Einstellungen sind nicht verfügbar",
    "Les réglages des fournisseurs sont indisponibles",
  ],
  "settings.providers.panel.checkingPermissions": [
    "Checking what this session is allowed to change.",
    "Es wird geprüft, was diese Sitzung ändern darf.",
    "Vérification des modifications autorisées pour cette session.",
  ],
  "settings.providers.panel.waitingConfiguration": [
    "Waiting for {{environment}} configuration.",
    "Warten auf die Konfiguration von {{environment}}.",
    "En attente de la configuration de {{environment}}.",
  ],
  "settings.providers.panel.noDevices": [
    "No connected devices",
    "Keine verbundenen Geräte",
    "Aucun appareil connecté",
  ],
  "settings.providers.panel.loadingDevices": [
    "Loading devices",
    "Geräte werden geladen",
    "Chargement des appareils",
  ],
  "settings.providers.panel.connectEnvironment": [
    "Connect an execution environment before configuring providers.",
    "Vor der Provider-Konfiguration eine Ausführungsumgebung verbinden.",
    "Connectez un environnement d’exécution avant de configurer les fournisseurs.",
  ],
  "settings.providers.panel.readingEnvironments": [
    "Reading connected execution environments.",
    "Verbundene Ausführungsumgebungen werden gelesen.",
    "Lecture des environnements d’exécution connectés.",
  ],
  "settings.providers.panel.checkedUnavailable": [
    "Checked unavailable",
    "Prüfzeit nicht verfügbar",
    "Date de vérification indisponible",
  ],
  "settings.providers.panel.checked": ["Checked {{time}}", "Geprüft {{time}}", "Vérifié {{time}}"],
  "settings.providers.panel.checkedAgo": [
    "Checked {{time}} ago",
    "Vor {{time}} geprüft",
    "Vérifié il y a {{time}}",
  ],
  "settings.providers.panel.updateFailed": [
    "Could not update {{provider}}",
    "{{provider}} konnte nicht aktualisiert werden",
    "Impossible de mettre à jour {{provider}}",
  ],
  "settings.providers.panel.updateStartFailed": [
    "The provider update command could not be started.",
    "Der Provider-Update-Befehl konnte nicht gestartet werden.",
    "La commande de mise à jour du fournisseur n’a pas pu être lancée.",
  ],
  "settings.providers.panel.resetLabel": [
    "{{provider}} provider settings",
    "Provider-Einstellungen für {{provider}}",
    "Réglages du fournisseur {{provider}}",
  ],
  "settings.providers.panel.refresh": [
    "Refresh provider status",
    "Providerstatus aktualisieren",
    "Actualiser l’état des fournisseurs",
  ],
  "settings.providers.panel.add": ["Add provider", "Provider hinzufügen", "Ajouter un fournisseur"],
  "settings.providers.panel.limited": [
    "Limited permissions",
    "Eingeschränkte Berechtigungen",
    "Autorisations limitées",
  ],
  "settings.providers.panel.readOnly": [
    "This session can view the providers on {{environment}}, but its credential does not allow changing their configuration.",
    "Diese Sitzung kann die Provider auf {{environment}} anzeigen, ihre Zugangsdaten erlauben jedoch keine Konfigurationsänderungen.",
    "Cette session peut consulter les fournisseurs sur {{environment}}, mais ses identifiants ne permettent pas de modifier leur configuration.",
  ],
  "settings.providers.panel.noneConfigured": [
    "No providers configured.",
    "Keine Provider konfiguriert.",
    "Aucun fournisseur configuré.",
  ],
  "settings.providers.panel.advanced": ["Advanced", "Erweitert", "Avancé"],
  "settings.providers.panel.healthInterval": [
    "Health check interval",
    "Intervall der Statusprüfung",
    "Intervalle de vérification de l’état",
  ],
  "settings.providers.panel.healthPolicy": [
    "This interval is configured here, then the shared Background activity policy decides whether provider probes may run when the timer fires. Custom intervals appear as Advanced in General settings.",
    "Dieses Intervall wird hier festgelegt. Die gemeinsame Richtlinie für Hintergrundaktivität entscheidet anschließend, ob Provider-Prüfungen beim Auslösen des Timers ausgeführt werden dürfen. Benutzerdefinierte Intervalle erscheinen in den allgemeinen Einstellungen als Erweitert.",
    "Cet intervalle est configuré ici. La politique partagée d’activité en arrière-plan décide ensuite si les vérifications des fournisseurs peuvent s’exécuter lorsque le minuteur se déclenche. Les intervalles personnalisés apparaissent sous Avancé dans les réglages généraux.",
  ],
  "settings.providers.panel.healthDescription": [
    "Refresh availability, versions, authentication state, and models in the background. 0 seconds turns background checks off.",
    "Verfügbarkeit, Versionen, Authentifizierungsstatus und Modelle im Hintergrund aktualisieren. 0 Sekunden deaktiviert Hintergrundprüfungen.",
    "Actualise en arrière-plan la disponibilité, les versions, l’authentification et les modèles. 0 seconde désactive les vérifications en arrière-plan.",
  ],
  "settings.providers.panel.healthReset": [
    "provider health check interval",
    "Intervall der Provider-Statusprüfung",
    "intervalle de vérification des fournisseurs",
  ],
  "settings.providers.panel.healthDecrease": [
    "Decrease provider health check interval",
    "Intervall der Provider-Statusprüfung verringern",
    "Réduire l’intervalle de vérification des fournisseurs",
  ],
  "settings.providers.panel.healthInput": [
    "Provider health check interval in seconds",
    "Intervall der Provider-Statusprüfung in Sekunden",
    "Intervalle de vérification des fournisseurs en secondes",
  ],
  "settings.providers.panel.healthIncrease": [
    "Increase provider health check interval",
    "Intervall der Provider-Statusprüfung erhöhen",
    "Augmenter l’intervalle de vérification des fournisseurs",
  ],
  "settings.providers.panel.seconds": ["seconds", "Sekunden", "secondes"],
  "settings.providers.badge.earlyAccess": ["Early Access", "Früher Zugriff", "Accès anticipé"],
});

export type SettingsProvidersInterfaceMessageKey =
  (typeof settingsProvidersInterfaceCatalog.keys)[number];
