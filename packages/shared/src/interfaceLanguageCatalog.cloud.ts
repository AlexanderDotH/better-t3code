import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Cloud, authentication, desktop handoff, root-error, and usage copy for the web client. */
export const cloudInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "cloud.action.continue": ["Continue", "Weiter", "Continuer"],
  "cloud.action.dismiss": ["Dismiss", "Schließen", "Ignorer"],
  "cloud.action.done": ["Done", "Fertig", "Terminer"],
  "cloud.action.notNow": ["Not now", "Nicht jetzt", "Pas maintenant"],
  "cloud.action.openApp": ["Open app", "App öffnen", "Ouvrir l’application"],
  "cloud.action.reloadApp": ["Reload app", "App neu laden", "Recharger l’application"],
  "cloud.action.signIn": ["Sign in", "Anmelden", "Se connecter"],
  "cloud.action.tryAgain": ["Try again", "Erneut versuchen", "Réessayer"],
  "cloud.action.copyTraceId": ["Copy trace ID", "Trace-ID kopieren", "Copier l’ID de trace"],
  "cloud.environment.addedTitle": [
    "Environment added",
    "Umgebung hinzugefügt",
    "Environnement ajouté",
  ],
  "cloud.environment.connectingDescription": [
    "Connecting to {{environment}} through T3 Connect.",
    "Verbindung mit {{environment}} über T3 Connect wird hergestellt.",
    "Connexion à {{environment}} via T3 Connect.",
  ],
  "cloud.environment.connectFailed": [
    "Could not connect environment",
    "Umgebung konnte nicht verbunden werden",
    "Impossible de connecter l’environnement",
  ],
  "cloud.environment.connectFailureFallback": [
    "Could not connect the T3 Connect environment.",
    "Die T3-Connect-Umgebung konnte nicht verbunden werden.",
    "Impossible de connecter l’environnement T3 Connect.",
  ],
  "cloud.environment.offline": [
    "You appear to be offline.",
    "Du scheinst offline zu sein.",
    "Vous semblez être hors ligne.",
  ],
  "cloud.environment.loadFailed": [
    "Could not load T3 Connect environments",
    "T3-Connect-Umgebungen konnten nicht geladen werden",
    "Impossible de charger les environnements T3 Connect",
  ],
  "cloud.environment.availableRelayOnline": [
    "Available · Relay online",
    "Verfügbar · Relay online",
    "Disponible · Relais en ligne",
  ],
  "cloud.environment.availableRelayOffline": [
    "Available · Relay offline",
    "Verfügbar · Relay offline",
    "Disponible · Relais hors ligne",
  ],
  "cloud.environment.availableRelayChecking": [
    "Available · Checking relay status…",
    "Verfügbar · Relay-Status wird geprüft…",
    "Disponible · Vérification du relais…",
  ],
  "cloud.environment.availableRelayUnavailable": [
    "Available · Relay status unavailable",
    "Verfügbar · Relay-Status nicht verfügbar",
    "Disponible · État du relais indisponible",
  ],
  "cloud.environment.relayOnline": ["Relay online", "Relay online", "Relais en ligne"],
  "cloud.environment.relayOffline": ["Relay offline", "Relay offline", "Relais hors ligne"],
  "cloud.environment.relayChecking": [
    "Checking relay status",
    "Relay-Status wird geprüft",
    "Vérification du relais",
  ],
  "cloud.environment.relayUnavailable": [
    "Relay status unavailable",
    "Relay-Status nicht verfügbar",
    "État du relais indisponible",
  ],
  "cloud.environment.connect": ["Connect", "Verbinden", "Connecter"],
  "cloud.environment.connecting": ["Connecting…", "Verbindung…", "Connexion…"],
  "cloud.connection.connected": ["Connected", "Verbunden", "Connecté"],
  "cloud.connection.connecting": ["Connecting…", "Verbindung…", "Connexion…"],
  "cloud.connection.reconnecting": ["Reconnecting…", "Erneute Verbindung…", "Reconnexion…"],
  "cloud.connection.failed": [
    "Connection failed",
    "Verbindung fehlgeschlagen",
    "Échec de la connexion",
  ],
  "cloud.connection.offline": ["Offline", "Offline", "Hors ligne"],
  "cloud.connection.notConnected": ["Not connected", "Nicht verbunden", "Non connecté"],
  "cloud.connection.available": ["Available", "Verfügbar", "Disponible"],
  "cloud.connection.failedReason": [
    "Connection failed. Reason: {{error}}",
    "Verbindung fehlgeschlagen. Grund: {{error}}",
    "Échec de la connexion. Motif : {{error}}",
  ],
  "cloud.connection.reconnectingReason": [
    "Failed to connect. Reconnecting… Reason: {{error}}",
    "Verbindung fehlgeschlagen. Erneuter Verbindungsversuch… Grund: {{error}}",
    "Échec de la connexion. Reconnexion… Motif : {{error}}",
  ],
  "cloud.onboarding.title": [
    "Connect an environment to get started",
    "Zum Start eine Umgebung verbinden",
    "Connectez un environnement pour commencer",
  ],
  "cloud.onboarding.cloudDescription": [
    "Sign in to T3 Connect to connect a linked environment through its managed tunnel, or add a reachable backend manually.",
    "Melde dich bei T3 Connect an, um eine verknüpfte Umgebung über ihren verwalteten Tunnel zu verbinden, oder füge ein erreichbares Backend manuell hinzu.",
    "Connectez-vous à T3 Connect pour relier un environnement via son tunnel géré, ou ajoutez manuellement un serveur accessible.",
  ],
  "cloud.onboarding.manualDescription": [
    "Add a reachable backend manually to start working from this browser.",
    "Füge ein erreichbares Backend manuell hinzu, um in diesem Browser zu arbeiten.",
    "Ajoutez manuellement un serveur accessible pour travailler depuis ce navigateur.",
  ],
  "cloud.onboarding.openConnections": [
    "Open Connections",
    "Verbindungen öffnen",
    "Ouvrir les connexions",
  ],
  "cloud.onboarding.addEnvironment": [
    "Add environment",
    "Umgebung hinzufügen",
    "Ajouter un environnement",
  ],
  "cloud.preview.desktopOnlyTitle": [
    "Preview is desktop-only",
    "Vorschau ist nur auf dem Desktop verfügbar",
    "L’aperçu est réservé à l’application de bureau",
  ],
  "cloud.preview.desktopOnlyDescription": [
    "Open T3 Code in the desktop app to use the in-app preview.",
    "Öffne T3 Code in der Desktop-App, um die integrierte Vorschau zu verwenden.",
    "Ouvrez T3 Code dans l’application de bureau pour utiliser l’aperçu intégré.",
  ],

  "serverUpdate.stage.downloading": ["Downloading…", "Wird heruntergeladen…", "Téléchargement…"],
  "serverUpdate.stage.restarting": ["Restarting…", "Wird neu gestartet…", "Redémarrage…"],
  "serverUpdate.action.update": ["Update", "Aktualisieren", "Mettre à jour"],
  "serverUpdate.serverLabel": [
    "{{environment}} server",
    "Server {{environment}}",
    "Serveur {{environment}}",
  ],
  "serverUpdate.thisServer": ["this server", "dieser Server", "ce serveur"],
  "serverUpdate.failureFallback": [
    "Server update failed.",
    "Das Server-Update ist fehlgeschlagen.",
    "La mise à jour du serveur a échoué.",
  ],
  "providerUpdate.failureFallback": [
    "Provider update failed.",
    "Anbieteraktualisierung fehlgeschlagen.",
    "La mise à jour du fournisseur a échoué.",
  ],
  "providerUpdate.timeout": [
    "Update timed out. Try again.",
    "Zeitüberschreitung bei der Aktualisierung. Versuche es erneut.",
    "La mise à jour a expiré. Réessayez.",
  ],
  "providerUpdate.disconnected": [
    "This environment is not connected. Try again after it reconnects.",
    "Diese Umgebung ist nicht verbunden. Versuche es nach der Wiederherstellung erneut.",
    "Cet environnement n’est pas connecté. Réessayez après sa reconnexion.",
  ],
  "serverUpdate.copy.successTitle": [
    "Update command copied",
    "Update-Befehl kopiert",
    "Commande de mise à jour copiée",
  ],
  "serverUpdate.copy.successDescription": [
    "Run `{{command}}` on {{server}} to update it.",
    "`{{command}}` auf {{server}} ausführen, um den Server zu aktualisieren.",
    "Exécutez `{{command}}` sur {{server}} pour le mettre à jour.",
  ],
  "serverUpdate.copy.failureTitle": [
    "Could not copy update command",
    "Update-Befehl konnte nicht kopiert werden",
    "Impossible de copier la commande de mise à jour",
  ],
  "serverUpdate.failureTitle": [
    "Server update failed",
    "Server-Update fehlgeschlagen",
    "Échec de la mise à jour du serveur",
  ],
  "serverUpdate.successTitle": [
    "{{server}} updated",
    "{{server}} wurde aktualisiert",
    "{{server}} a été mis à jour",
  ],
  "serverUpdate.successDescription": [
    "Reconnected on t3@{{version}}.",
    "Erneut mit t3@{{version}} verbunden.",
    "Reconnecté avec t3@{{version}}.",
  ],
  "serverUpdate.desktopManaged": [
    "Update the desktop app on that machine to update this server.",
    "Die Desktop-App auf diesem Rechner aktualisieren, um diesen Server zu aktualisieren.",
    "Mettez à jour l’application de bureau sur cette machine pour mettre à jour ce serveur.",
  ],
  "serverUpdate.containerManaged": [
    "Pull the updated image and recreate this container to update the server.",
    "Das aktualisierte Image laden und den Container neu erstellen, um den Server zu aktualisieren.",
    "Récupérez l’image mise à jour et recréez ce conteneur pour mettre à jour le serveur.",
  ],
  "serverUpdate.copyCommand": [
    "Copy update command",
    "Update-Befehl kopieren",
    "Copier la commande de mise à jour",
  ],

  "splash.accessibilityLabel": [
    "T3 Code splash screen",
    "T3-Code-Startbildschirm",
    "Écran de démarrage de T3 Code",
  ],

  "pairing.pending.title": [
    "Pairing with this environment",
    "Kopplung mit dieser Umgebung",
    "Association à cet environnement",
  ],
  "pairing.pending.description": [
    "Validating the pairing link and preparing your session.",
    "Der Kopplungslink wird geprüft und die Sitzung vorbereitet.",
    "Validation du lien d’association et préparation de votre session.",
  ],
  "pairing.title": [
    "Pair with this environment",
    "Mit dieser Umgebung koppeln",
    "Associer cet environnement",
  ],
  "pairing.gate.desktop": [
    "This environment expects a trusted pairing credential before the app can connect.",
    "Diese Umgebung erwartet vertrauenswürdige Kopplungsdaten, bevor die App eine Verbindung herstellen kann.",
    "Cet environnement exige un identifiant d’association de confiance avant que l’application puisse se connecter.",
  ],
  "pairing.gate.token": [
    "Enter a pairing token to start a session with this environment.",
    "Ein Kopplungstoken eingeben, um eine Sitzung mit dieser Umgebung zu starten.",
    "Saisissez un jeton d’association pour démarrer une session avec cet environnement.",
  ],
  "pairing.token.label": ["Pairing token", "Kopplungstoken", "Jeton d’association"],
  "pairing.token.placeholder": [
    "Paste a one-time token or pairing secret",
    "Einmaltoken oder Kopplungsgeheimnis einfügen",
    "Collez un jeton à usage unique ou un secret d’association",
  ],
  "pairing.action.pairing": ["Pairing…", "Wird gekoppelt…", "Association…"],
  "pairing.methods.both": [
    "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.",
    "Diese Umgebung akzeptiert sowohl Desktop-verwaltete Kopplung als auch Einmal-Kopplungstoken.",
    "Cet environnement accepte l’association gérée par l’application de bureau et les jetons d’association à usage unique.",
  ],
  "pairing.methods.desktop": [
    "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.",
    "Diese Umgebung wird von der Desktop-App verwaltet. Öffne sie über die Desktop-App oder füge ausdrücklich ausgestellte Start-Zugangsdaten ein.",
    "Cet environnement est géré par l’application de bureau. Ouvrez-le depuis celle-ci ou collez un identifiant d’amorçage s’il a été émis explicitement.",
  ],
  "pairing.methods.token": [
    "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.",
    "Diese Umgebung akzeptiert Einmal-Kopplungstoken. Kopplungslinks können diese Seite direkt öffnen; alternativ kann das Token hier eingefügt werden.",
    "Cet environnement accepte les jetons d’association à usage unique. Les liens d’association peuvent ouvrir cette page directement, ou vous pouvez coller le jeton ici.",
  ],
  "pairing.hosted.connecting": [
    "Connecting to this backend.",
    "Verbindung mit diesem Backend wird hergestellt.",
    "Connexion à ce serveur principal.",
  ],
  "pairing.hosted.missingRequest": [
    "This pairing link is missing its backend host or token.",
    "Diesem Kopplungslink fehlt der Backend-Host oder das Token.",
    "L’hôte du serveur principal ou le jeton manque dans ce lien d’association.",
  ],
  "pairing.hosted.tokenAlreadyUsed": [
    "This one-time pairing token was already submitted. Request a new pairing link.",
    "Dieses Einmal-Kopplungstoken wurde bereits übermittelt. Fordere einen neuen Kopplungslink an.",
    "Ce jeton d’association à usage unique a déjà été envoyé. Demandez un nouveau lien d’association.",
  ],
  "pairing.hosted.defaultEnvironment": ["The environment", "Die Umgebung", "L’environnement"],
  "pairing.hosted.saved": [
    "{{environment}} is saved in this browser.",
    "{{environment}} wurde in diesem Browser gespeichert.",
    "{{environment}} est enregistré dans ce navigateur.",
  ],
  "pairing.hosted.failureWithRetry": [
    "{{error}} If the backend accepted this one-time token, request a new pairing link before retrying.",
    "{{error}} Falls das Backend dieses Einmaltoken angenommen hat, fordere vor einem neuen Versuch einen neuen Kopplungslink an.",
    "{{error}} Si le serveur principal a accepté ce jeton à usage unique, demandez un nouveau lien d’association avant de réessayer.",
  ],
  "pairing.hosted.title.paired": ["Backend paired", "Backend gekoppelt", "Serveur associé"],
  "pairing.hosted.title.failed": [
    "Pairing failed",
    "Kopplung fehlgeschlagen",
    "Échec de l’association",
  ],
  "pairing.hosted.title.pairing": [
    "Pairing backend",
    "Backend wird gekoppelt",
    "Association du serveur",
  ],
  "pairing.hosted.hostLabel": ["Host", "Host", "Hôte"],
  "pairing.hosted.corsGuidance": [
    "Verify the backend is reachable from this browser, supports CORS for hosted clients, and is served over HTTPS when opening this page from HTTPS.",
    "Prüfe, ob das Backend von diesem Browser erreichbar ist, CORS für gehostete Clients unterstützt und bei einem HTTPS-Aufruf dieser Seite ebenfalls über HTTPS bereitgestellt wird.",
    "Vérifiez que le serveur principal est accessible depuis ce navigateur, autorise CORS pour les clients hébergés et utilise HTTPS lorsque cette page est ouverte en HTTPS.",
  ],
  "pairing.authenticationFailed": [
    "Authentication failed.",
    "Authentifizierung fehlgeschlagen.",
    "Échec de l’authentification.",
  ],

  "mobileClients.status.pushNotifications": [
    "Push notifications",
    "Push-Benachrichtigungen",
    "Notifications push",
  ],
  "mobileClients.status.liveActivities": [
    "Live Activities",
    "Live-Aktivitäten",
    "Activités en direct",
  ],
  "mobileClients.platform.withVersion": [
    "iOS {{iosVersion}} · T3 Code {{appVersion}}",
    "iOS {{iosVersion}} · T3 Code {{appVersion}}",
    "iOS {{iosVersion}} · T3 Code {{appVersion}}",
  ],
  "mobileClients.platform.withoutVersion": [
    "iOS {{iosVersion}}",
    "iOS {{iosVersion}}",
    "iOS {{iosVersion}}",
  ],
  "mobileClients.updated.unavailable": [
    "Update time unavailable",
    "Aktualisierungszeit nicht verfügbar",
    "Heure de mise à jour indisponible",
  ],
  "mobileClients.updated.label": [
    "Updated {{date}}",
    "Aktualisiert am {{date}}",
    "Mis à jour le {{date}}",
  ],
  "mobileClients.preference.approvals": ["approvals", "Freigaben", "approbations"],
  "mobileClients.preference.inputRequests": [
    "input requests",
    "Eingabeanfragen",
    "demandes de saisie",
  ],
  "mobileClients.preference.completions": ["completions", "Abschlüsse", "terminaisons"],
  "mobileClients.preference.failures": ["failures", "Fehler", "échecs"],
  "mobileClients.notifications.disabled": [
    "Push notifications are disabled on this device.",
    "Push-Benachrichtigungen sind auf diesem Gerät deaktiviert.",
    "Les notifications push sont désactivées sur cet appareil.",
  ],
  "mobileClients.notifications.alertsEnabled": [
    "Alerts enabled for {{types}}.",
    "Hinweise aktiviert für {{types}}.",
    "Alertes activées pour {{types}}.",
  ],
  "mobileClients.notifications.noTypes": [
    "Push notifications are enabled, but no alert types are selected.",
    "Push-Benachrichtigungen sind aktiviert, aber es wurden keine Hinweistypen ausgewählt.",
    "Les notifications push sont activées, mais aucun type d’alerte n’est sélectionné.",
  ],
  "mobileClients.loading": [
    "Loading mobile clients",
    "Mobile Clients werden geladen",
    "Chargement des clients mobiles",
  ],
  "mobileClients.empty.title": ["No mobile clients", "Keine Mobile Clients", "Aucun client mobile"],
  "mobileClients.empty.description": [
    "Sign in to T3 Code on your iPhone to register it for push notifications and Live Activities.",
    "Melde dich auf deinem iPhone bei T3 Code an, um es für Push-Benachrichtigungen und Live-Aktivitäten zu registrieren.",
    "Connectez-vous à T3 Code sur votre iPhone pour l’inscrire aux notifications push et aux activités en direct.",
  ],
  "mobileClients.title": ["Mobile clients", "Mobile Clients", "Clients mobiles"],
  "mobileClients.description": [
    "Devices registered to receive T3 Connect activity from your environments.",
    "Geräte, die für T3-Connect-Aktivitäten aus deinen Umgebungen registriert sind.",
    "Appareils inscrits pour recevoir l’activité T3 Connect de vos environnements.",
  ],
  "mobileClients.loadFailed": [
    "Could not load mobile clients",
    "Mobile Clients konnten nicht geladen werden",
    "Impossible de charger les clients mobiles",
  ],

  "t3Connect.label": ["T3 Connect", "T3 Connect", "T3 Connect"],
  "t3Connect.signIn": [
    "Sign in to T3 Connect",
    "Bei T3 Connect anmelden",
    "Se connecter à T3 Connect",
  ],
  "t3Connect.linkDateUnavailable": [
    "Link date unavailable",
    "Verknüpfungsdatum nicht verfügbar",
    "Date de liaison indisponible",
  ],
  "t3Connect.linkedAt": ["Linked {{date}}", "Verknüpft am {{date}}", "Lié le {{date}}"],
  "t3Connect.endpoint.managedTunnel": ["Managed tunnel", "Verwalteter Tunnel", "Tunnel géré"],
  "t3Connect.endpoint.activityOnly": [
    "Activity publishing only",
    "Nur Aktivitätsveröffentlichung",
    "Publication d’activité uniquement",
  ],
  "t3Connect.deregister.action": ["Deregister", "Abmelden", "Désinscrire"],
  "t3Connect.deregister.pending": ["Deregistering…", "Wird abgemeldet…", "Désinscription…"],
  "t3Connect.deregister.confirmAria": [
    "Confirm deregistration of {{environment}}",
    "Abmeldung von {{environment}} bestätigen",
    "Confirmer la désinscription de {{environment}}",
  ],
  "t3Connect.deregister.title": ["Deregister server", "Server abmelden", "Désinscrire le serveur"],
  "t3Connect.deregister.confirmDescription": [
    "“{{environment}}” will be removed from this account.",
    "„{{environment}}“ wird aus diesem Konto entfernt.",
    "« {{environment}} » sera supprimé de ce compte.",
  ],
  "t3Connect.deregister.consequences": [
    "T3 Connect access will be revoked, any managed tunnel will be removed, and a host space will become available. Local connections on your devices are not changed.",
    "Der T3-Connect-Zugriff wird entzogen, ein verwalteter Tunnel wird entfernt und ein Host-Platz wird frei. Lokale Verbindungen auf deinen Geräten bleiben unverändert.",
    "L’accès T3 Connect sera révoqué, tout tunnel géré sera supprimé et une place d’hôte sera libérée. Les connexions locales sur vos appareils ne changent pas.",
  ],
  "t3Connect.deregister.successTitle": [
    "Server deregistered",
    "Server abgemeldet",
    "Serveur désinscrit",
  ],
  "t3Connect.deregister.successDescription": [
    "T3 Connect access was revoked and a host space is now available.",
    "Der T3-Connect-Zugriff wurde entzogen und ein Host-Platz ist jetzt verfügbar.",
    "L’accès T3 Connect a été révoqué et une place d’hôte est maintenant disponible.",
  ],
  "t3Connect.deregister.failureFallback": [
    "Could not deregister the server.",
    "Der Server konnte nicht abgemeldet werden.",
    "Impossible de désinscrire le serveur.",
  ],
  "t3Connect.deregister.failureTitle": [
    "Could not deregister server",
    "Server konnte nicht abgemeldet werden",
    "Impossible de désinscrire le serveur",
  ],
  "t3Connect.profile.description": [
    "Environments registered to your account. Connections on this device are managed in Settings.",
    "Bei deinem Konto registrierte Umgebungen. Verbindungen auf diesem Gerät werden in den Einstellungen verwaltet.",
    "Environnements inscrits sur votre compte. Les connexions de cet appareil sont gérées dans les réglages.",
  ],
  "t3Connect.loadFailed": [
    "Could not load T3 Connect environments",
    "T3-Connect-Umgebungen konnten nicht geladen werden",
    "Impossible de charger les environnements T3 Connect",
  ],
  "t3Connect.loading": [
    "Loading environments…",
    "Umgebungen werden geladen…",
    "Chargement des environnements…",
  ],
  "t3Connect.empty.title": [
    "No T3 Connect environments",
    "Keine T3-Connect-Umgebungen",
    "Aucun environnement T3 Connect",
  ],
  "t3Connect.empty.description": [
    "Link an environment from its local Settings to make it available through T3 Connect.",
    "Verknüpfe eine Umgebung in ihren lokalen Einstellungen, um sie über T3 Connect verfügbar zu machen.",
    "Liez un environnement depuis ses réglages locaux pour le rendre disponible via T3 Connect.",
  ],

  "connectCli.authorizationRequest": [
    "Authorization request",
    "Autorisierungsanfrage",
    "Demande d’autorisation",
  ],
  "connectCli.incomplete.title": [
    "This connect link is incomplete",
    "Dieser Verbindungslink ist unvollständig",
    "Ce lien de connexion est incomplet",
  ],
  "connectCli.incomplete.description": [
    "The link is missing its authorization request. Re-run `t3 connect` in your terminal and open the freshly printed URL.",
    "Dem Link fehlt die Autorisierungsanfrage. Führe `t3 connect` erneut im Terminal aus und öffne die neu ausgegebene URL.",
    "La demande d’autorisation manque dans le lien. Relancez `t3 connect` dans votre terminal et ouvrez la nouvelle URL affichée.",
  ],
  "connectCli.browserStep": [
    "Browser authorization",
    "Browser-Autorisierung",
    "Autorisation dans le navigateur",
  ],
  "connectCli.browserStepNumbered": [
    "Step 1 of 2 · Browser authorization",
    "Schritt 1 von 2 · Browser-Autorisierung",
    "Étape 1 sur 2 · Autorisation dans le navigateur",
  ],
  "connectCli.connecting.title": [
    "Connecting your terminal",
    "Terminal wird verbunden",
    "Connexion de votre terminal",
  ],
  "connectCli.connecting.redirecting": [
    "Redirecting to authorize T3 Connect for your CLI…",
    "Weiterleitung zur Autorisierung von T3 Connect für deine CLI…",
    "Redirection pour autoriser T3 Connect pour votre CLI…",
  ],
  "connectCli.connecting.signIn": [
    "Sign in to continue authorizing T3 Connect for your CLI.",
    "Melde dich an, um T3 Connect für deine CLI zu autorisieren.",
    "Connectez-vous pour continuer à autoriser T3 Connect pour votre CLI.",
  ],
  "connectCli.terminalStep": [
    "Step 2 of 2 · Terminal handoff",
    "Schritt 2 von 2 · Übergabe ans Terminal",
    "Étape 2 sur 2 · Transfert au terminal",
  ],
  "connectCli.callback.missingTitle": [
    "Authorization did not complete",
    "Autorisierung wurde nicht abgeschlossen",
    "L’autorisation ne s’est pas terminée",
  ],
  "connectCli.callback.missingDescription": [
    "No authorization code was returned. Re-run `t3 connect` in your terminal and try again.",
    "Es wurde kein Autorisierungscode zurückgegeben. Führe `t3 connect` erneut im Terminal aus und versuche es noch einmal.",
    "Aucun code d’autorisation n’a été renvoyé. Relancez `t3 connect` dans votre terminal et réessayez.",
  ],
  "connectCli.callback.mismatchTitle": [
    "This code belongs to a different request",
    "Dieser Code gehört zu einer anderen Anfrage",
    "Ce code appartient à une autre demande",
  ],
  "connectCli.callback.mismatchDescription": [
    "This authorization response does not match a connect request started in this browser. Re-run `t3 connect` in your terminal and open the freshly printed URL in this browser.",
    "Diese Autorisierungsantwort gehört nicht zu einer in diesem Browser gestarteten Verbindungsanfrage. Führe `t3 connect` erneut im Terminal aus und öffne die neu ausgegebene URL in diesem Browser.",
    "Cette réponse d’autorisation ne correspond pas à une demande de connexion lancée dans ce navigateur. Relancez `t3 connect` dans votre terminal et ouvrez la nouvelle URL dans ce navigateur.",
  ],
  "connectCli.callback.title": ["Almost connected", "Fast verbunden", "Connexion presque terminée"],
  "connectCli.callback.accountDescription": [
    "Enter this code in your waiting terminal to connect it as {{account}}.",
    "Gib diesen Code im wartenden Terminal ein, um es als {{account}} zu verbinden.",
    "Saisissez ce code dans le terminal en attente pour le connecter en tant que {{account}}.",
  ],
  "connectCli.callback.description": [
    "Enter this code in your waiting terminal to finish connecting.",
    "Gib diesen Code im wartenden Terminal ein, um die Verbindung abzuschließen.",
    "Saisissez ce code dans le terminal en attente pour terminer la connexion.",
  ],
  "connectCli.callback.codeLabel": [
    "One-time authorization code",
    "Einmaliger Autorisierungscode",
    "Code d’autorisation à usage unique",
  ],
  "connectCli.callback.expiresSoon": ["expires shortly", "läuft bald ab", "expire bientôt"],
  "connectCli.callback.copied": ["Copied!", "Kopiert!", "Copié !"],
  "connectCli.callback.copy": [
    "Copy authorization code",
    "Autorisierungscode kopieren",
    "Copier le code d’autorisation",
  ],
  "connectCli.callback.securityNotice": [
    "Only enter this code in a terminal session you started yourself. Anyone holding it can link their machine to your T3 Connect account while it is valid.",
    "Gib diesen Code nur in einer selbst gestarteten Terminalsitzung ein. Solange er gültig ist, kann jede Person mit diesem Code ihren Rechner mit deinem T3-Connect-Konto verknüpfen.",
    "Saisissez ce code uniquement dans une session de terminal que vous avez lancée. Tant qu’il est valide, toute personne qui le possède peut relier sa machine à votre compte T3 Connect.",
  ],

  "connectOnboarding.enabledTitle": [
    "T3 Connect enabled",
    "T3 Connect aktiviert",
    "T3 Connect activé",
  ],
  "connectOnboarding.enabledTunnelDescription": [
    "This environment is available to your other devices through T3 Connect.",
    "Diese Umgebung ist über T3 Connect auf deinen anderen Geräten verfügbar.",
    "Cet environnement est disponible sur vos autres appareils via T3 Connect.",
  ],
  "connectOnboarding.enabledActivityDescription": [
    "This environment publishes agent activity to your mobile clients.",
    "Diese Umgebung veröffentlicht Agentenaktivitäten für deine Mobile Clients.",
    "Cet environnement publie l’activité des agents sur vos clients mobiles.",
  ],
  "connectOnboarding.title": [
    "Set up T3 Connect",
    "T3 Connect einrichten",
    "Configurer T3 Connect",
  ],
  "connectOnboarding.description": [
    "Connect your devices in one place. Publish this environment, then connect the rest.",
    "Verbinde deine Geräte an einem Ort. Veröffentliche diese Umgebung und verbinde anschließend die übrigen.",
    "Connectez vos appareils au même endroit. Publiez cet environnement, puis connectez les autres.",
  ],
  "connectOnboarding.dontShowAgain": [
    "Don’t show this again",
    "Nicht mehr anzeigen",
    "Ne plus afficher",
  ],
  "connectOnboarding.enabling": ["Enabling…", "Wird aktiviert…", "Activation…"],
  "connectOnboarding.step": ["Step {{step}}", "Schritt {{step}}", "Étape {{step}}"],
  "connectOnboarding.step.publish": ["Publish", "Veröffentlichen", "Publier"],
  "connectOnboarding.step.devices": [
    "Connect devices",
    "Geräte verbinden",
    "Connecter les appareils",
  ],
  "connectOnboarding.publishEnvironment.title": [
    "Publish this environment",
    "Diese Umgebung veröffentlichen",
    "Publier cet environnement",
  ],
  "connectOnboarding.publishEnvironment.description": [
    "Make this environment available to your other devices through T3 Connect.",
    "Diese Umgebung über T3 Connect auf deinen anderen Geräten verfügbar machen.",
    "Rendre cet environnement disponible sur vos autres appareils via T3 Connect.",
  ],
  "connectOnboarding.publishActivity.title": [
    "Publish agent activity",
    "Agentenaktivität veröffentlichen",
    "Publier l’activité des agents",
  ],
  "connectOnboarding.publishActivity.description": [
    "Send activity from this environment to your mobile clients for push notifications and Live Activities.",
    "Aktivitäten aus dieser Umgebung für Push-Benachrichtigungen und Live-Aktivitäten an deine Mobile Clients senden.",
    "Envoyer l’activité de cet environnement à vos clients mobiles pour les notifications push et les activités en direct.",
  ],
  "connectOnboarding.empty": [
    "No other environments are published to your account yet. Publish one from another device and it will show up here.",
    "In deinem Konto sind noch keine weiteren Umgebungen veröffentlicht. Veröffentliche eine auf einem anderen Gerät; sie erscheint dann hier.",
    "Aucun autre environnement n’est encore publié sur votre compte. Publiez-en un depuis un autre appareil et il apparaîtra ici.",
  ],

  "relayInstall.stage.checking": [
    "Checking current installation",
    "Aktuelle Installation wird geprüft",
    "Vérification de l’installation actuelle",
  ],
  "relayInstall.stage.waitingForLock": [
    "Waiting for installer",
    "Warten auf das Installationsprogramm",
    "En attente du programme d’installation",
  ],
  "relayInstall.stage.downloading": [
    "Downloading relay client",
    "Relay-Client wird heruntergeladen",
    "Téléchargement du client relais",
  ],
  "relayInstall.stage.verifying": [
    "Verifying download",
    "Download wird überprüft",
    "Vérification du téléchargement",
  ],
  "relayInstall.stage.installing": [
    "Installing relay client",
    "Relay-Client wird installiert",
    "Installation du client relais",
  ],
  "relayInstall.stage.validating": [
    "Validating executable",
    "Ausführbare Datei wird geprüft",
    "Validation de l’exécutable",
  ],
  "relayInstall.stage.activating": [
    "Activating installation",
    "Installation wird aktiviert",
    "Activation de l’installation",
  ],
  "relayInstall.confirmTitle": [
    "Install relay client?",
    "Relay-Client installieren?",
    "Installer le client relais ?",
  ],
  "relayInstall.installingDescription": [
    "T3 Code is preparing this environment for secure access through T3 Connect.",
    "T3 Code bereitet diese Umgebung für den sicheren Zugriff über T3 Connect vor.",
    "T3 Code prépare cet environnement pour un accès sécurisé via T3 Connect.",
  ],
  "relayInstall.confirmDescription": [
    "T3 Code needs the relay client to make this environment available through T3 Connect.",
    "T3 Code benötigt den Relay-Client, um diese Umgebung über T3 Connect verfügbar zu machen.",
    "T3 Code a besoin du client relais pour rendre cet environnement disponible via T3 Connect.",
  ],
  "relayInstall.progressAria": [
    "Relay client installation progress",
    "Installationsfortschritt des Relay-Clients",
    "Progression de l’installation du client relais",
  ],
  "relayInstall.progressCount": [
    "{{current}} of {{total}}",
    "{{current}} von {{total}}",
    "{{current}} sur {{total}}",
  ],
  "relayInstall.keepOpen": [
    "Keep T3 Code open while the relay client is installed.",
    "T3 Code geöffnet lassen, während der Relay-Client installiert wird.",
    "Gardez T3 Code ouvert pendant l’installation du client relais.",
  ],
  "relayInstall.managedTitle": [
    "Managed relay client",
    "Verwalteter Relay-Client",
    "Client relais géré",
  ],
  "relayInstall.versionDescription": [
    "T3 Code will download and install version {{version}} locally.",
    "T3 Code lädt Version {{version}} herunter und installiert sie lokal.",
    "T3 Code téléchargera et installera localement la version {{version}}.",
  ],
  "relayInstall.downloadAndInstall": [
    "Download and install",
    "Herunterladen und installieren",
    "Télécharger et installer",
  ],

  "sshPassword.failureFallback": [
    "SSH password prompt failed.",
    "Die SSH-Passwortabfrage ist fehlgeschlagen.",
    "La demande de mot de passe SSH a échoué.",
  ],
  "sshPassword.expired": [
    "This SSH password prompt expired. Try connecting again.",
    "Diese SSH-Passwortabfrage ist abgelaufen. Stelle die Verbindung erneut her.",
    "Cette demande de mot de passe SSH a expiré. Essayez de vous reconnecter.",
  ],
  "sshPassword.title": [
    "SSH Password Required",
    "SSH-Passwort erforderlich",
    "Mot de passe SSH requis",
  ],
  "sshPassword.description": [
    "T3 needs your SSH password to connect to {{target}}. The password is passed to the local SSH process for this connection attempt and is not saved by T3 Code.",
    "T3 benötigt dein SSH-Passwort, um eine Verbindung mit {{target}} herzustellen. Das Passwort wird für diesen Verbindungsversuch an den lokalen SSH-Prozess übergeben und nicht von T3 Code gespeichert.",
    "T3 a besoin de votre mot de passe SSH pour se connecter à {{target}}. Le mot de passe est transmis au processus SSH local pour cette tentative de connexion et n’est pas enregistré par T3 Code.",
  ],
  "sshPassword.expiredLabel": ["Expired", "Abgelaufen", "Expiré"],
  "sshPassword.keysHint": [
    "Use SSH keys to avoid repeated password prompts on new SSH sessions.",
    "Verwende SSH-Schlüssel, um wiederholte Passwortabfragen bei neuen SSH-Sitzungen zu vermeiden.",
    "Utilisez des clés SSH pour éviter les demandes répétées de mot de passe lors de nouvelles sessions SSH.",
  ],

  "desktopUpdate.openNotesFailed": [
    "Unable to open release notes",
    "Versionshinweise konnten nicht geöffnet werden",
    "Impossible d’ouvrir les notes de version",
  ],
  "desktopUpdate.readMore": ["Read more", "Mehr erfahren", "En savoir plus"],
  "desktopUpdate.downloadedTitle": [
    "Update downloaded",
    "Update heruntergeladen",
    "Mise à jour téléchargée",
  ],
  "desktopUpdate.downloadedDescription": [
    "Restart the app from the update button to install it.",
    "Starte die App über die Update-Schaltfläche neu, um das Update zu installieren.",
    "Redémarrez l’application avec le bouton de mise à jour pour l’installer.",
  ],

  "usage.title": ["Usage", "Nutzung", "Utilisation"],
  "usage.breadcrumbAria": [
    "Usage breadcrumb",
    "Navigationspfad zur Nutzung",
    "Fil d’Ariane de l’utilisation",
  ],
  "usage.metricAria": ["Usage metric", "Nutzungsmetrik", "Mesure d’utilisation"],
  "usage.periodAria": ["Usage period", "Nutzungszeitraum", "Période d’utilisation"],
  "usage.refreshAria": ["Refresh usage", "Nutzung aktualisieren", "Actualiser l’utilisation"],
  "usage.metric.cost": ["Cost", "Kosten", "Coût"],
  "usage.metric.tokens": ["Tokens", "Token", "Jetons"],
  "usage.window.past24Hours": ["Past 24h", "Letzte 24 Std.", "24 h passées"],
  "usage.window.days7": ["7 days", "7 Tage", "7 jours"],
  "usage.window.days30": ["30 days", "30 Tage", "30 jours"],
  "usage.window.days90": ["90 days", "90 Tage", "90 jours"],
  "usage.window.range": ["{{from}} to {{to}}", "{{from}} bis {{to}}", "{{from}} à {{to}}"],
  "usage.sessions": [
    { one: "{{formattedCount}} session", other: "{{formattedCount}} sessions" },
    { one: "{{formattedCount}} Sitzung", other: "{{formattedCount}} Sitzungen" },
    { one: "{{formattedCount}} session", other: "{{formattedCount}} sessions" },
  ],
  "usage.summary.cost": [
    "{{sessions}} · API estimate",
    "{{sessions}} · API-Schätzung",
    "{{sessions}} · estimation API",
  ],
  "usage.summary.tokens": ["{{sessions}}", "{{sessions}}", "{{sessions}}"],
  "usage.provider.costShare": [
    "{{share}} of cost · {{tokens}} tokens",
    "{{share}} der Kosten · {{tokens}} Token",
    "{{share}} du coût · {{tokens}} jetons",
  ],
  "usage.provider.tokenShare": [
    "{{share}} of tokens · {{cost}}",
    "{{share}} der Token · {{cost}}",
    "{{share}} des jetons · {{cost}}",
  ],
  "usage.chart.hourlyTokens": [
    "Hourly processed tokens",
    "Stündlich verarbeitete Token",
    "Jetons traités par heure",
  ],
  "usage.chart.hourlyCost": ["Hourly cost", "Stündliche Kosten", "Coût horaire"],
  "usage.chart.dailyTokens": [
    "Daily processed tokens",
    "Täglich verarbeitete Token",
    "Jetons traités par jour",
  ],
  "usage.chart.dailyCost": ["Daily cost", "Tägliche Kosten", "Coût quotidien"],
  "usage.chart.aria": [
    "{{summary}} by provider",
    "{{summary}} nach Provider",
    "{{summary}} par fournisseur",
  ],
  "usage.totals": ["Totals", "Gesamtwerte", "Totaux"],
  "usage.processedTokens": ["Processed tokens", "Verarbeitete Token", "Jetons traités"],
  "usage.processedTotal": ["Processed total", "Verarbeitet gesamt", "Total traité"],
  "usage.cachedInput": ["Cached input", "Eingabe aus Cache", "Entrée mise en cache"],
  "usage.newInput": ["New input", "Neue Eingabe", "Nouvelle entrée"],
  "usage.uncachedInput": ["Uncached input", "Eingabe ohne Cache", "Entrée non mise en cache"],
  "usage.cacheWrites": ["Cache writes", "Cache-Schreibvorgänge", "Écritures de cache"],
  "usage.output": ["Output", "Ausgabe", "Sortie"],
  "usage.reasoning": ["Reasoning", "Reasoning", "Raisonnement"],
  "usage.cacheSavings": ["Cache savings", "Cache-Ersparnis", "Économie grâce au cache"],
  "usage.calls": ["Calls by role", "Aufrufe nach Rolle", "Appels par rôle"],
  "usage.calls.root": ["Root calls", "Root-Aufrufe", "Appels racine"],
  "usage.calls.subagent": ["Subagent calls", "Subagent-Aufrufe", "Appels de sous-agents"],
  "usage.calls.metadata": [
    "Hidden metadata calls",
    "Verdeckte Metadaten-Aufrufe",
    "Appels de métadonnées masqués",
  ],
  "usage.calls.auto-reasoning": [
    "Auto reasoning calls",
    "Auto-Reasoning-Aufrufe",
    "Appels de raisonnement automatique",
  ],
  "usage.calls.unknown": [
    "Unattributed calls",
    "Nicht zugeordnete Aufrufe",
    "Appels non attribués",
  ],
  "usage.calls.records": [
    { one: "{{formattedCount}} call", other: "{{formattedCount}} calls" },
    { one: "{{formattedCount}} Aufruf", other: "{{formattedCount}} Aufrufe" },
    { one: "{{formattedCount}} appel", other: "{{formattedCount}} appels" },
  ],
  "usage.contextDiagnostics": ["Context diagnostics", "Kontextdiagnose", "Diagnostic du contexte"],
  "usage.context.nativeForks": ["Native forks", "Native Forks", "Forks natifs"],
  "usage.context.compactHandoffs": [
    "Compact handoffs",
    "Kompakte Übergaben",
    "Transferts compacts",
  ],
  "usage.context.handoffCharacters": [
    "Handoff characters",
    "Übergabezeichen",
    "Caractères de transfert",
  ],
  "usage.context.compactionEvents": [
    "Compaction events",
    "Kompaktierungsereignisse",
    "Événements de compactage",
  ],
  "usage.context.maxContext": ["Largest context", "Größter Kontext", "Contexte maximal"],
  "usage.context.instructionCharacters": [
    "Instruction characters",
    "Anweisungszeichen",
    "Caractères d’instructions",
  ],
  "usage.context.memoryInjectionCharacters": [
    "Memory injection characters",
    "Zeichen der Memory-Injektion",
    "Caractères d’injection de mémoire",
  ],
  "usage.context.toolSchemaCharacters": [
    "Tool schema characters",
    "Tool-Schema-Zeichen",
    "Caractères de schémas d’outils",
  ],
  "usage.context.subagentResultCharacters": [
    "Subagent result characters",
    "Zeichen in Subagent-Ergebnissen",
    "Caractères de résultats de sous-agents",
  ],
  "usage.context.toolDigestCharacters": [
    "Tool digest characters",
    "Zeichen in Tool-Kurzfassungen",
    "Caractères de résumés d’outils",
  ],
  "usage.context.autoRoutingCharacters": [
    "Auto routing characters",
    "Zeichen für Auto-Routing",
    "Caractères de routage automatique",
  ],
  "usage.breakdown": ["Breakdown", "Aufschlüsselung", "Répartition"],
  "usage.breakdownAria": [
    "Usage breakdown",
    "Nutzungsaufschlüsselung",
    "Répartition de l’utilisation",
  ],
  "usage.model": ["Model", "Modell", "Modèle"],
  "usage.hour": ["Hour", "Stunde", "Heure"],
  "usage.day": ["Day", "Tag", "Jour"],
  "usage.share": ["Share", "Anteil", "Part"],
  "usage.total": ["Total", "Gesamt", "Total"],
  "usage.emptyWindow": [
    "No activity in this window.",
    "Keine Aktivität in diesem Zeitraum.",
    "Aucune activité pendant cette période.",
  ],
  "usage.coverage.failed": [
    "{{environment}} could not report usage.",
    "{{environment}} konnte keine Nutzungsdaten melden.",
    "{{environment}} n’a pas pu transmettre les données d’utilisation.",
  ],
  "usage.coverage.stale": [
    "{{environment}} runs an older server version and is excluded from totals.",
    "{{environment}} verwendet eine ältere Serverversion und wird von den Gesamtwerten ausgeschlossen.",
    "{{environment}} utilise une ancienne version du serveur et est exclu des totaux.",
  ],
  "usage.coverage.duplicates": [
    "Counted once across environments sharing a transcript directory: {{sources}}",
    "Bei Umgebungen mit gemeinsamem Transkriptverzeichnis nur einmal gezählt: {{sources}}",
    "Compté une seule fois pour les environnements partageant un dossier de transcription : {{sources}}",
  ],
  "usage.deviceScanning": [
    {
      one: "{{formattedCount}} device still scanning",
      other: "{{formattedCount}} devices still scanning",
    },
    {
      one: "{{formattedCount}} Gerät wird noch geprüft",
      other: "{{formattedCount}} Geräte werden noch geprüft",
    },
    {
      one: "{{formattedCount}} appareil est encore analysé",
      other: "{{formattedCount}} appareils sont encore analysés",
    },
  ],

  "root.error.title": [
    "Something went wrong.",
    "Etwas ist schiefgelaufen.",
    "Une erreur s’est produite.",
  ],
  "root.error.showDetails": [
    "Show error details",
    "Fehlerdetails anzeigen",
    "Afficher les détails de l’erreur",
  ],
  "root.error.hideDetails": [
    "Hide error details",
    "Fehlerdetails ausblenden",
    "Masquer les détails de l’erreur",
  ],
  "root.error.unexpected": [
    "An unexpected router error occurred.",
    "Ein unerwarteter Router-Fehler ist aufgetreten.",
    "Une erreur inattendue du routeur s’est produite.",
  ],
  "root.error.noDetails": [
    "No additional error details are available.",
    "Keine weiteren Fehlerdetails verfügbar.",
    "Aucun détail supplémentaire sur l’erreur n’est disponible.",
  ],
  "root.keybindings.updatedTitle": [
    "Keybindings updated",
    "Tastenbelegungen aktualisiert",
    "Raccourcis clavier mis à jour",
  ],
  "root.keybindings.updatedDescription": [
    "Keybindings configuration reloaded successfully.",
    "Die Konfiguration der Tastenbelegungen wurde erfolgreich neu geladen.",
    "La configuration des raccourcis clavier a été rechargée.",
  ],
  "root.keybindings.invalidTitle": [
    "Invalid keybindings configuration",
    "Ungültige Tastenbelegungskonfiguration",
    "Configuration de raccourcis clavier non valide",
  ],
  "root.keybindings.openAction": [
    "Open keybindings.json",
    "keybindings.json öffnen",
    "Ouvrir keybindings.json",
  ],
  "root.keybindings.openFailedTitle": [
    "Unable to open keybindings file",
    "Tastenbelegungsdatei konnte nicht geöffnet werden",
    "Impossible d’ouvrir le fichier de raccourcis clavier",
  ],
  "root.keybindings.openFailedFallback": [
    "Unknown error opening file.",
    "Unbekannter Fehler beim Öffnen der Datei.",
    "Erreur inconnue lors de l’ouverture du fichier.",
  ],
});

export type CloudInterfaceMessageKey = (typeof cloudInterfaceCatalog.keys)[number];
