import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const coreInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "resourceProtection.waiting.label": [
    "Subagent waiting for memory",
    "Subagent wartet auf freien Speicher",
    "Sous-agent en attente de mémoire",
  ],
  "resourceProtection.waiting.description": [
    "The start resumes automatically when memory is available; stopping remains possible at any time.",
    "Der Start wird automatisch fortgesetzt, sobald Speicher verfügbar ist; Stoppen bleibt jederzeit möglich.",
    "Le démarrage reprend automatiquement lorsque la mémoire est disponible ; l’arrêt reste possible à tout moment.",
  ],
  "resourceProtection.throttled.label": [
    "Provider temporarily throttled",
    "Provider vorübergehend gedrosselt",
    "Fournisseur temporairement limité",
  ],
  "resourceProtection.throttled.description": [
    "T3 automatically resumes the provider after five healthy memory readings.",
    "T3 setzt den Provider nach fünf gesunden Speichermessungen automatisch fort.",
    "T3 reprend automatiquement le fournisseur après cinq mesures de mémoire saines.",
  ],
  "resourceProtection.recovering.description": [
    "The memory reserve is stabilizing; T3 automatically resumes the provider.",
    "Die Speicherreserve stabilisiert sich; T3 setzt den Provider automatisch fort.",
    "La réserve de mémoire se stabilise ; T3 reprend automatiquement le fournisseur.",
  ],
  "resourceProtection.unavailableWaiting.description": [
    "The start resumes as soon as T3 can safely measure available memory again; stopping remains possible.",
    "Der Start wird fortgesetzt, sobald T3 den verfügbaren Speicher wieder sicher messen kann; Stoppen bleibt möglich.",
    "Le démarrage reprend dès que T3 peut de nouveau mesurer la mémoire disponible en toute sécurité ; l’arrêt reste possible.",
  ],
  "resourceProtection.unavailableThrottled.description": [
    "T3 resumes the provider as soon as available memory can be measured safely again.",
    "T3 setzt den Provider fort, sobald der verfügbare Speicher wieder sicher messbar ist.",
    "T3 reprend le fournisseur dès que la mémoire disponible peut de nouveau être mesurée en toute sécurité.",
  ],
  "settings.interfaceLanguage.title": ["Language", "Sprache", "Langue"],
  "settings.interfaceLanguage.description": [
    "Choose the interface language. System follows this device; explicit choices synchronize across connected T3 environments.",
    "Legt die Sprache der Oberfläche fest. „System“ folgt diesem Gerät; eine feste Auswahl wird über verbundene T3-Umgebungen synchronisiert.",
    "Choisissez la langue de l’interface. Système suit cet appareil ; les choix explicites sont synchronisés entre les environnements T3 connectés.",
  ],
  "settings.interfaceLanguage.system": ["System", "System", "Système"],
  "settings.interfaceLanguage.english": ["English", "Englisch", "Anglais"],
  "settings.interfaceLanguage.german": ["German", "Deutsch", "Allemand"],
  "settings.interfaceLanguage.french": ["French", "Französisch", "Français"],
  "settings.interfaceLanguage.systemDescription": [
    "Follow this device's preferred language.",
    "Folgt der bevorzugten Sprache dieses Geräts.",
    "Suit la langue préférée de cet appareil.",
  ],
  "settings.interfaceLanguage.englishDescription": [
    "Always use English on every connected client.",
    "Verwendet auf allen verbundenen Clients immer Englisch.",
    "Utilise toujours l’anglais sur tous les clients connectés.",
  ],
  "settings.interfaceLanguage.germanDescription": [
    "Always use German on every connected client.",
    "Verwendet auf allen verbundenen Clients immer Deutsch.",
    "Utilise toujours l’allemand sur tous les clients connectés.",
  ],
  "settings.interfaceLanguage.frenchDescription": [
    "Always use French on every connected client.",
    "Verwendet auf allen verbundenen Clients immer Französisch.",
    "Utilise toujours le français sur tous les clients connectés.",
  ],
  "settings.interfaceLanguage.syncing": [
    "Syncing with connected servers…",
    "Synchronisierung mit verbundenen Servern…",
    "Synchronisation avec les serveurs connectés…",
  ],
  "settings.interfaceLanguage.syncFailed": [
    "Couldn’t sync to {{environments}}. Retrying automatically.",
    "Synchronisierung mit {{environments}} fehlgeschlagen. Ein neuer Versuch erfolgt automatisch.",
    "Échec de la synchronisation avec {{environments}}. Une nouvelle tentative sera effectuée automatiquement.",
  ],
  "settings.interfaceLanguage.syncUnsupported": [
    "Update {{environments}} to synchronize this setting.",
    "{{environments}} aktualisieren, um diese Einstellung zu synchronisieren.",
    "Mettez à jour {{environments}} pour synchroniser ce réglage.",
  ],
  "settings.interfaceLanguage.syncDeferred": [
    "Waiting for {{environments}} to reconnect.",
    "Warten auf die erneute Verbindung mit {{environments}}.",
    "En attente de la reconnexion de {{environments}}.",
  ],
  "common.ok": ["OK", "OK", "OK"],
  "common.enabled": ["Enabled", "Aktiviert", "Activé"],
  "common.disabled": ["Disabled", "Deaktiviert", "Désactivé"],
  "common.open": ["Open", "Öffnen", "Ouvrir"],
  "common.configure": ["Configure", "Konfigurieren", "Configurer"],
  "common.search": ["Search", "Suchen", "Rechercher"],
  "common.close": ["Close", "Schließen", "Fermer"],
  "common.all": ["All", "Alle", "Tous"],
  "common.clear": ["Clear", "Leeren", "Effacer"],
  "common.cancel": ["Cancel", "Abbrechen", "Annuler"],
  "common.retry": ["Retry", "Erneut versuchen", "Réessayer"],
  "common.pause": ["Pause", "Pausieren", "Suspendre"],
  "common.resume": ["Resume", "Fortsetzen", "Reprendre"],
  "common.rebuild": ["Rebuild", "Neu aufbauen", "Reconstruire"],
  "common.loading": ["Loading…", "Wird geladen…", "Chargement…"],
  "common.unavailable": ["Unavailable", "Nicht verfügbar", "Indisponible"],
  "common.done": ["Done", "Fertig", "Terminé"],
  "common.edit": ["Edit", "Bearbeiten", "Modifier"],
  "common.continue": ["Continue", "Fortfahren", "Continuer"],
});

export type CoreInterfaceMessageKey = (typeof coreInterfaceCatalog.keys)[number];
