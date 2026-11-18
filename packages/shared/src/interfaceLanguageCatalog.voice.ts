import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const voiceInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "chat.composer.voiceRestoreOriginal": [
    "Restore original",
    "Original wiederherstellen",
    "Restaurer l’original",
  ],
  "chat.composer.voiceProcessing": [
    "Processing voice input…",
    "Spracheingabe wird nachbearbeitet…",
    "Traitement de la saisie vocale…",
  ],
  "chat.composer.voiceInterpreting": [
    "Reconciling 3 transcripts…",
    "3 Transkripte werden abgeglichen…",
    "Comparaison de 3 transcriptions…",
  ],
  "settings.voice.options.advancedMode": ["Advanced mode", "Erweiterter Modus", "Mode avancé"],
  "settings.voice.options.advancedModeHint": [
    "Speak once. Compare three transcriptions with an AI model. Costs three transcriptions plus one model call, before cleanup.",
    "Einmal sprechen. Drei Transkripte per KI abgleichen. Kostet drei Transkriptionen und einen Modellaufruf vor der Bereinigung.",
    "Parlez une fois. Comparez trois transcriptions avec une IA. Coût : trois transcriptions et un appel au modèle, avant le nettoyage.",
  ],
  "settings.voice.options.interpretationModel": [
    "Interpretation model",
    "Interpretationsmodell",
    "Modèle d’interprétation",
  ],
  "settings.voice.options.advancedUnsupported": [
    "Update this environment to use advanced voice input.",
    "Aktualisiere diese Umgebung für die erweiterte Spracheingabe.",
    "Mettez cet environnement à jour pour utiliser la saisie vocale avancée.",
  ],
  "chat.composer.voiceCancel": [
    "Cancel voice input",
    "Spracheingabe abbrechen",
    "Annuler la saisie vocale",
  ],
  "settings.voice.options.title": [
    "Recording and cleanup",
    "Aufnahme und Bereinigung",
    "Enregistrement et nettoyage",
  ],
  "settings.voice.options.defaults": [
    "Environment defaults",
    "Umgebungsstandards",
    "Valeurs par défaut de l’environnement",
  ],
  "settings.voice.options.project": [
    "Project voice settings",
    "Spracheinstellungen des Projekts",
    "Réglages vocaux du projet",
  ],
  "settings.voice.options.inherited": [
    "Uses the environment defaults.",
    "Verwendet die Umgebungsstandards.",
    "Utilise les valeurs par défaut de l’environnement.",
  ],
  "settings.voice.options.override": [
    "Customize for this project",
    "Für dieses Projekt anpassen",
    "Personnaliser pour ce projet",
  ],
  "settings.voice.options.inherit": [
    "Use environment defaults",
    "Umgebungsstandards verwenden",
    "Utiliser les valeurs par défaut de l’environnement",
  ],
  "settings.voice.options.unsupported": [
    "Update this environment to configure recording and cloud cleanup.",
    "Aktualisiere diese Umgebung, um Aufnahme und Cloud-Bereinigung einzustellen.",
    "Mettez cet environnement à jour pour configurer l’enregistrement et le nettoyage cloud.",
  ],
  "settings.voice.options.saveFailed": [
    "Voice settings could not be saved. Your changes are still here.",
    "Spracheinstellungen konnten nicht gespeichert werden. Deine Änderungen bleiben erhalten.",
    "Impossible d’enregistrer les réglages vocaux. Vos modifications sont conservées.",
  ],
  "settings.voice.options.cancel": [
    "Discard changes",
    "Änderungen verwerfen",
    "Annuler les modifications",
  ],
  "settings.voice.options.validation": [
    "Check the values: minimum silence must not exceed maximum silence; use up to 100 terms of 50 characters each and valid language codes such as de or en.",
    "Prüfe die Werte: Die minimale Pause darf die maximale nicht überschreiten. Verwende bis zu 100 Begriffe mit jeweils 50 Zeichen und Sprachcodes wie de oder en.",
    "Vérifiez les valeurs : le silence minimal ne doit pas dépasser le silence maximal ; utilisez au plus 100 termes de 50 caractères et des codes de langue comme fr ou en.",
  ],
  "settings.voice.options.speechModel": [
    "Speech recognition model",
    "Spracherkennungsmodell",
    "Modèle de reconnaissance vocale",
  ],
  "settings.voice.options.languages": [
    "Expected languages",
    "Erwartete Sprachen",
    "Langues attendues",
  ],
  "settings.voice.options.languagesHint": [
    "Comma-separated language codes, such as de, en. Leave empty for automatic detection.",
    "Sprachcodes durch Kommas trennen, z. B. de, en. Leer lassen für automatische Erkennung.",
    "Codes de langue séparés par des virgules, par exemple fr, en. Laissez vide pour la détection automatique.",
  ],
  "settings.voice.options.englishOnly": [
    "This model recognizes English. Language hints are available with Universal 3.5 Pro.",
    "Dieses Modell erkennt Englisch. Sprachhinweise sind mit Universal 3.5 Pro verfügbar.",
    "Ce modèle reconnaît l’anglais. Les indications de langue sont disponibles avec Universal 3.5 Pro.",
  ],
  "settings.voice.options.proOnly": [
    "Available with Universal 3.5 Pro.",
    "Mit Universal 3.5 Pro verfügbar.",
    "Disponible avec Universal 3.5 Pro.",
  ],
  "settings.voice.options.mode": [
    "Accuracy and latency",
    "Genauigkeit und Latenz",
    "Précision et latence",
  ],
  "settings.voice.options.balanced": ["Balanced", "Ausgewogen", "Équilibré"],
  "settings.voice.options.accuracy": [
    "Maximum accuracy",
    "Höchste Genauigkeit",
    "Précision maximale",
  ],
  "settings.voice.options.latency": ["Minimum latency", "Geringste Latenz", "Latence minimale"],
  "settings.voice.options.minSilence": [
    "Minimum pause (ms)",
    "Minimale Sprechpause (ms)",
    "Pause minimale (ms)",
  ],
  "settings.voice.options.maxSilence": [
    "Maximum pause (ms)",
    "Maximale Sprechpause (ms)",
    "Pause maximale (ms)",
  ],
  "settings.voice.options.vad": [
    "Voice activity threshold",
    "Spracherkennungsschwelle",
    "Seuil d’activité vocale",
  ],
  "settings.voice.options.vadHint": [
    "0 to 1. Higher values require stronger speech confidence.",
    "0 bis 1. Höhere Werte erfordern eine stärkere Sprachsicherheit.",
    "De 0 à 1. Les valeurs élevées exigent une détection vocale plus certaine.",
  ],
  "settings.voice.options.partials": [
    "Show live transcript",
    "Live-Transkript anzeigen",
    "Afficher la transcription en direct",
  ],
  "settings.voice.options.continuous": [
    "Continuous interim results",
    "Kontinuierliche Zwischenstände",
    "Résultats intermédiaires continus",
  ],
  "settings.voice.options.delay": [
    "First interim result delay (ms)",
    "Verzögerung des ersten Zwischenstands (ms)",
    "Délai du premier résultat intermédiaire (ms)",
  ],
  "settings.voice.options.vocabulary": [
    "Use project vocabulary",
    "Projektvokabular verwenden",
    "Utiliser le vocabulaire du projet",
  ],
  "settings.voice.options.vocabularyHint": [
    "Use project identifiers and learn confirmed terms to improve recognition and cleanup. Turn off to stop using and learning project terms.",
    "Projektbegriffe verwenden und bestätigte Begriffe lernen, um Erkennung und Bereinigung zu verbessern. Ausschalten, um Projektbegriffe weder zu verwenden noch zu lernen.",
    "Utiliser les identifiants du projet et apprendre les termes confirmés pour améliorer la reconnaissance et le nettoyage. Désactiver pour ne plus utiliser ni apprendre ces termes.",
  ],
  "settings.voice.learned.title": [
    "Learned project terms",
    "Gelernte Projektbegriffe",
    "Termes appris pour le projet",
  ],
  "settings.voice.learned.description": [
    "Keeps up to 256 confirmed terms, with frequency and last use. Full transcripts are not stored. Clearing starts learning again; turn off project vocabulary to stop it.",
    "Speichert bis zu 256 bestätigte Begriffe mit Häufigkeit und letzter Verwendung. Vollständige Transkripte werden nicht gespeichert. Nach dem Leeren beginnt das Lernen erneut; zum Stoppen Projektvokabular ausschalten.",
    "Conserve jusqu’à 256 termes confirmés, leur fréquence et leur dernière utilisation. Les transcriptions complètes ne sont pas stockées. Effacer relance l’apprentissage ; désactiver le vocabulaire du projet pour l’arrêter.",
  ],
  "settings.voice.learned.clear": [
    "Clear learned terms",
    "Gelernte Begriffe leeren",
    "Effacer les termes appris",
  ],
  "settings.voice.learned.empty": [
    "No learned terms yet.",
    "Noch keine gelernten Begriffe.",
    "Aucun terme appris pour le moment.",
  ],
  "settings.voice.learned.failed": [
    "Learned terms are unavailable.",
    "Gelernte Begriffe sind nicht verfügbar.",
    "Les termes appris sont indisponibles.",
  ],
  "settings.voice.options.terms": [
    "Additional terms",
    "Zusätzliche Begriffe",
    "Termes supplémentaires",
  ],
  "settings.voice.options.termsHint": [
    "One term per line. Up to 100 terms, each at most 50 characters.",
    "Ein Begriff pro Zeile. Bis zu 100 Begriffe mit jeweils höchstens 50 Zeichen.",
    "Un terme par ligne. Jusqu’à 100 termes de 50 caractères maximum.",
  ],
  "settings.voice.options.context": [
    "Additional recognition context",
    "Zusätzlicher Erkennungskontext",
    "Contexte de reconnaissance supplémentaire",
  ],
  "settings.voice.options.contextHint": [
    "Describe terminology or the topic. Cleanup instructions belong below.",
    "Beschreibe Fachbegriffe oder das Thema. Bereinigungsanweisungen gehören weiter unten hin.",
    "Décrivez le vocabulaire ou le sujet. Les consignes de nettoyage se règlent ci-dessous.",
  ],
  "settings.voice.options.focus": ["Voice focus", "Sprachfokus", "Focalisation vocale"],
  "settings.voice.options.near": ["Near microphone", "Nah am Mikrofon", "Près du microphone"],
  "settings.voice.options.far": ["Far from microphone", "Fern vom Mikrofon", "Loin du microphone"],
  "settings.voice.options.cleanup": [
    "Cleanup after recording",
    "Bereinigung nach der Aufnahme",
    "Nettoyage après l’enregistrement",
  ],
  "settings.voice.options.off": ["Off", "Aus", "Désactivé"],
  "settings.voice.options.conservative": [
    "Gentle, remove digressions",
    "Behutsam, Abschweifungen entfernen",
    "Doux, supprimer les digressions",
  ],
  "settings.voice.options.compact": ["Compact", "Kompakt", "Concis"],
  "settings.voice.options.custom": [
    "Custom instructions",
    "Eigene Anweisung",
    "Consignes personnalisées",
  ],
  "settings.voice.options.cleanupHint": [
    "Keeps requirements, details, and negations. Removes filler, repetition, retracted statements, and unrelated digressions. Choose a T3 model or an AssemblyAI Gateway model. Review before sending.",
    "Erhält Anforderungen, Details und Verneinungen. Entfernt Füllwörter, Wiederholungen, zurückgenommene Aussagen und auftragsfremde Abschweifungen. Wähle ein T3-Modell oder ein AssemblyAI-Gateway-Modell. Vor dem Senden prüfen.",
    "Conserve les exigences, détails et négations. Supprime hésitations, répétitions, propos rétractés et digressions sans rapport. Choisissez un modèle T3 ou AssemblyAI Gateway. Relisez avant d’envoyer.",
  ],
  "settings.voice.options.instructions": [
    "Additional cleanup instructions",
    "Zusätzliche Bereinigungsanweisung",
    "Consignes de nettoyage supplémentaires",
  ],
  "settings.voice.options.cleanupModel": [
    "Voice cleanup model",
    "Modell für Voice-Nachbearbeitung",
    "Modèle de nettoyage vocal",
  ],
  "settings.voice.options.modelsLoading": [
    "Loading AssemblyAI Gateway models…",
    "AssemblyAI-Gateway-Modelle werden geladen…",
    "Chargement des modèles AssemblyAI Gateway…",
  ],
  "settings.voice.options.modelsFailed": [
    "The AssemblyAI Gateway model catalog is unavailable. Your selected model is retained.",
    "Der Modellkatalog von AssemblyAI Gateway ist nicht verfügbar. Das gewählte Modell bleibt erhalten.",
    "Le catalogue de modèles AssemblyAI Gateway est indisponible. Le modèle choisi est conservé.",
  ],
  "settings.voice.options.modelsRetry": [
    "Reload model catalog",
    "Modellkatalog neu laden",
    "Recharger le catalogue de modèles",
  ],
  "settings.voice.options.files": [
    "Create file references automatically",
    "Dateiverweise automatisch erstellen",
    "Créer automatiquement des références de fichiers",
  ],
  "settings.voice.options.filesHint": [
    "Show the filename only. If several files match, preview the first and give all candidates to the agent.",
    "Nur den Dateinamen anzeigen. Bei mehreren Treffern den ersten vorschauen und alle Kandidaten an den Agenten geben.",
    "Afficher seulement le nom du fichier. En cas de correspondances multiples, prévisualiser la première et transmettre tous les candidats à l’agent.",
  ],
});

export type VoiceInterfaceMessageKey = (typeof voiceInterfaceCatalog.keys)[number];
