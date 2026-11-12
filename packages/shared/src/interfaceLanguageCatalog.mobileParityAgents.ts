import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for agents parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityAgentsInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.agents.none": ["None", "Keine", "Aucun"],
  "mobile.agents.changeModel": ["Change model", "Modell ändern", "Changer de modèle"],
  "mobile.agents.resetOptions": [
    "Use default options",
    "Standardoptionen verwenden",
    "Utiliser les options par défaut",
  ],
  "mobile.agents.defaultModel": [
    "Default model for new threads",
    "Standardmodell für neue Threads",
    "Modèle par défaut des nouveaux fils",
  ],
  "mobile.agents.fallbackModel": ["Fallback model", "Ersatzmodell", "Modèle de secours"],
  "mobile.agents.modelScope": [
    "Text generation scope",
    "Geltungsbereich der Textgenerierung",
    "Portée de la génération de texte",
  ],
  "mobile.agents.environmentDefault": [
    "Environment default",
    "Umgebungsstandard",
    "Valeur par défaut de l’environnement",
  ],
  "mobile.agents.inheritTextModel": [
    "Use environment text model",
    "Textmodell der Umgebung verwenden",
    "Utiliser le modèle de texte de l’environnement",
  ],
  "mobile.agents.storedSecret": [
    "Stored secret; enter a replacement",
    "Gespeichertes Geheimnis; Ersatz eingeben",
    "Secret enregistré ; saisir une nouvelle valeur",
  ],
  "mobile.agents.addProvider": [
    "Add provider instance",
    "Anbieterinstanz hinzufügen",
    "Ajouter une instance de fournisseur",
  ],
  "mobile.agents.editProvider": [
    "Provider settings",
    "Anbietereinstellungen",
    "Paramètres du fournisseur",
  ],
  "mobile.agents.displayName": ["Display name", "Anzeigename", "Nom affiché"],
  "mobile.agents.accentColor": ["Accent color", "Akzentfarbe", "Couleur d’accentuation"],
  "mobile.agents.customColor": ["Hex color", "Hex-Farbe", "Couleur hexadécimale"],
  "mobile.agents.invalidColor": [
    "Enter a color such as #2563eb.",
    "Eine Farbe wie #2563eb eingeben.",
    "Saisir une couleur comme #2563eb.",
  ],
  "mobile.agents.runtimeMode": ["Codex runtime", "Codex-Laufzeit", "Environnement Codex"],
  "mobile.agents.managedRuntime": [
    "Managed by T3 Code",
    "Von T3 Code verwaltet",
    "Géré par T3 Code",
  ],
  "mobile.agents.existingRuntime": [
    "Existing installation on the host",
    "Vorhandene Installation auf dem Host",
    "Installation existante sur l’hôte",
  ],
  "mobile.agents.arguments": ["Command arguments", "Befehlsargumente", "Arguments de commande"],
  "mobile.agents.addArgument": ["Add argument", "Argument hinzufügen", "Ajouter un argument"],
  "mobile.agents.invalidConfig": [
    "Check the provider configuration values.",
    "Die Werte der Anbieterkonfiguration prüfen.",
    "Vérifier les valeurs de configuration du fournisseur.",
  ],
  "mobile.agents.environmentInvalid": [
    "Use unique variable names containing letters, digits and underscores; names cannot start with a digit.",
    "Eindeutige Variablennamen aus Buchstaben, Ziffern und Unterstrichen verwenden; Namen dürfen nicht mit einer Ziffer beginnen.",
    "Utiliser des noms de variables uniques composés de lettres, chiffres et tirets bas, sans chiffre initial.",
  ],
  "mobile.agents.variableValue": ["Value", "Wert", "Valeur"],
  "mobile.agents.secretSource": ["Value source", "Wertquelle", "Source de la valeur"],
  "mobile.agents.secretReference": ["Secret reference", "Geheimnisreferenz", "Référence de secret"],
  "mobile.agents.invalidReference": [
    "Enter a valid secret reference.",
    "Eine gültige Geheimnisreferenz eingeben.",
    "Saisir une référence de secret valide.",
  ],
  "mobile.agents.sensitive": ["Sensitive value", "Vertraulicher Wert", "Valeur sensible"],
  "mobile.agents.providerSaveFailed": [
    "Could not save provider settings",
    "Anbietereinstellungen konnten nicht gespeichert werden",
    "Impossible d’enregistrer les paramètres du fournisseur",
  ],
  "mobile.agents.providerModels": [
    "Models and visibility",
    "Modelle und Sichtbarkeit",
    "Modèles et visibilité",
  ],
  "mobile.agents.showModel": [
    "Show in model pickers",
    "In der Modellauswahl anzeigen",
    "Afficher dans les sélecteurs de modèle",
  ],
  "mobile.agents.moveUp": ["Move up", "Nach oben", "Monter"],
  "mobile.agents.moveDown": ["Move down", "Nach unten", "Descendre"],
  "mobile.agents.customModel": [
    "Custom model",
    "Benutzerdefiniertes Modell",
    "Modèle personnalisé",
  ],
  "mobile.agents.addCustomModel": [
    "Add custom model",
    "Benutzerdefiniertes Modell hinzufügen",
    "Ajouter un modèle personnalisé",
  ],
  "mobile.agents.modelSlug": ["Model ID", "Modell-ID", "Identifiant du modèle"],
  "mobile.agents.customModelInvalid": [
    "Enter a unique model ID and valid option IDs, labels and choices.",
    "Eine eindeutige Modell-ID sowie gültige Options-IDs, Bezeichnungen und Auswahlwerte eingeben.",
    "Saisir un identifiant de modèle unique et des identifiants, libellés et choix d’option valides.",
  ],
  "mobile.agents.optionId": ["Option ID", "Options-ID", "Identifiant d’option"],
  "mobile.agents.optionLabel": ["Option label", "Optionsbezeichnung", "Libellé d’option"],
  "mobile.agents.optionChoices": ["Choices", "Auswahlwerte", "Choix"],
  "mobile.agents.optionToggle": ["Toggle", "Schalter", "Interrupteur"],
  "mobile.agents.choiceValue": ["Choice value", "Auswahlwert", "Valeur du choix"],
  "mobile.agents.choiceLabel": ["Choice label", "Auswahlbezeichnung", "Libellé du choix"],
  "mobile.agents.defaultChoice": ["Default choice", "Standardauswahl", "Choix par défaut"],
  "mobile.agents.addChoice": ["Add choice", "Auswahl hinzufügen", "Ajouter un choix"],
  "mobile.agents.addOption": ["Add option", "Option hinzufügen", "Ajouter une option"],
  "mobile.agents.copyOptions": [
    "Copy options from a model",
    "Optionen von einem Modell kopieren",
    "Copier les options d’un modèle",
  ],
  "mobile.agents.advanced": [
    "Provider behavior",
    "Anbieterverhalten",
    "Comportement des fournisseurs",
  ],
  "mobile.agents.usageSources": [
    "Usage limit sources",
    "Quellen für Nutzungslimits",
    "Sources des limites d’utilisation",
  ],
  "mobile.agents.addUsageSource": [
    "Add CLIProxyAPI hub",
    "CLIProxyAPI-Hub hinzufügen",
    "Ajouter un hub CLIProxyAPI",
  ],
  "mobile.agents.usageSource": ["CLIProxyAPI hub", "CLIProxyAPI-Hub", "Hub CLIProxyAPI"],
  "mobile.agents.hubUrl": ["Hub URL", "Hub-URL", "URL du hub"],
  "mobile.agents.managementKey": ["Management key", "Verwaltungsschlüssel", "Clé de gestion"],
  "mobile.agents.hubLabel": ["Label", "Bezeichnung", "Libellé"],
  "mobile.agents.invalidHub": [
    "Enter an HTTP(S) URL and a management key for a new hub.",
    "Für einen neuen Hub eine HTTP(S)-URL und einen Verwaltungsschlüssel eingeben.",
    "Saisir une URL HTTP(S) et une clé de gestion pour un nouveau hub.",
  ],
  "mobile.agents.removeHub": [
    "Remove this usage limit source?",
    "Diese Quelle für Nutzungslimits entfernen?",
    "Supprimer cette source de limites d’utilisation ?",
  ],
  "mobile.agents.cursorKeychain": [
    "Read Cursor usage from the host keychain",
    "Cursor-Nutzung aus dem Schlüsselbund des Hosts lesen",
    "Lire l’utilisation de Cursor depuis le trousseau de l’hôte",
  ],
  "mobile.agents.idleCompaction": [
    "Compact idle Claude threads",
    "Inaktive Claude-Threads komprimieren",
    "Compacter les fils Claude inactifs",
  ],
  "mobile.agents.idleDescription": [
    "Applies to idle Claude threads over 200,000 tokens. Each Claude instance can override this default.",
    "Gilt für inaktive Claude-Threads mit über 200.000 Tokens. Jede Claude-Instanz kann diesen Standard überschreiben.",
    "S’applique aux fils Claude inactifs de plus de 200 000 tokens. Chaque instance Claude peut remplacer cette valeur par défaut.",
  ],
  "mobile.agents.idle.onReturn": ["When you return", "Bei deiner Rückkehr", "À votre retour"],
  "mobile.agents.idle.beforeCacheExpires": [
    "Before the cache expires (beta)",
    "Vor Ablauf des Caches (Beta)",
    "Avant l’expiration du cache (bêta)",
  ],
  "mobile.agents.idle.off": ["Never", "Nie", "Jamais"],
  "mobile.agents.healthInterval": [
    "Provider health refresh interval (seconds)",
    "Aktualisierungsintervall für Anbieterstatus (Sekunden)",
    "Intervalle d’actualisation de l’état des fournisseurs (secondes)",
  ],
  "mobile.agents.healthDescription": [
    "Refresh status, versions and models in the background. Set to 0 to disable. The background activity policy also applies.",
    "Status, Versionen und Modelle im Hintergrund aktualisieren. 0 deaktiviert die Prüfung. Die Richtlinie für Hintergrundaktivität gilt ebenfalls.",
    "Actualiser l’état, les versions et les modèles en arrière-plan. 0 désactive les contrôles. La politique d’activité en arrière-plan s’applique aussi.",
  ],
  "mobile.agents.invalidInterval": [
    "Enter a whole number of seconds, 0 or greater.",
    "Eine ganze Anzahl Sekunden ab 0 eingeben.",
    "Saisir un nombre entier de secondes supérieur ou égal à 0.",
  ],
  "mobile.agents.modelCheckPassed": [
    "Model check passed",
    "Modellprüfung bestanden",
    "Vérification du modèle réussie",
  ],
});

export type MobileParityAgentsInterfaceMessageKey =
  (typeof mobileParityAgentsInterfaceCatalog.keys)[number];
