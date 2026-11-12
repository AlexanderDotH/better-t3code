import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

export const mobileParityMcpInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.mcp.manageServers": [
    "Manage MCP servers",
    "MCP-Server verwalten",
    "Gérer les serveurs MCP",
  ],
  "mobile.mcp.manageSkills": ["Manage skills", "Skills verwalten", "Gérer les skills"],
  "mobile.mcp.back": ["Back", "Zurück", "Retour"],
  "mobile.mcp.projectDirectory": [
    "Project directory on the server",
    "Projektverzeichnis auf dem Server",
    "Répertoire du projet sur le serveur",
  ],
  "mobile.mcp.projectIdentifier": [
    "Project ID (optional)",
    "Projekt-ID (optional)",
    "ID du projet (facultatif)",
  ],
  "mobile.mcp.projectRequired": [
    "Select a project or enter its directory on the server.",
    "Wähle ein Projekt oder gib sein Verzeichnis auf dem Server ein.",
    "Sélectionnez un projet ou saisissez son répertoire sur le serveur.",
  ],
  "mobile.mcp.nameRequired": [
    "Name is required.",
    "Ein Name ist erforderlich.",
    "Le nom est requis.",
  ],
  "mobile.mcp.identifierInvalid": [
    "Use an ID of up to 96 letters, numbers, underscores or hyphens, starting with a letter.",
    "Die ID darf bis zu 96 Buchstaben, Ziffern, Unterstriche oder Bindestriche enthalten und muss mit einem Buchstaben beginnen.",
    "L’ID doit commencer par une lettre et contenir au maximum 96 lettres, chiffres, tirets ou traits de soulignement.",
  ],
  "mobile.mcp.identifierDuplicate": [
    "A server with this ID already exists.",
    "Ein Server mit dieser ID existiert bereits.",
    "Un serveur avec cet ID existe déjà.",
  ],
  "mobile.mcp.stableIdentifier": [
    "A saved server’s ID cannot be changed.",
    "Die ID eines gespeicherten Servers lässt sich nicht ändern.",
    "L’ID d’un serveur enregistré ne peut pas être modifié.",
  ],
  "mobile.mcp.providerRequired": [
    "Select at least one provider account or enable all accounts.",
    "Wähle mindestens ein Anbieter-Konto oder aktiviere alle Konten.",
    "Sélectionnez au moins un compte fournisseur ou activez tous les comptes.",
  ],
  "mobile.mcp.commandRequired": [
    "Command is required.",
    "Ein Befehl ist erforderlich.",
    "La commande est requise.",
  ],
  "mobile.mcp.urlInvalid": [
    "URL must start with http:// or https://.",
    "Die URL muss mit http:// oder https:// beginnen.",
    "L’URL doit commencer par http:// ou https://.",
  ],
  "mobile.mcp.secretNameInvalid": [
    "Enter a valid environment variable or header name for each value.",
    "Gib für jeden Wert einen gültigen Umgebungsvariablen- oder Header-Namen ein.",
    "Saisissez un nom de variable d’environnement ou d’en-tête valide pour chaque valeur.",
  ],
  "mobile.mcp.secretNameDuplicate": [
    "Variable and header names must be unique.",
    "Variablen- und Header-Namen müssen eindeutig sein.",
    "Les noms de variables et d’en-têtes doivent être uniques.",
  ],
  "mobile.mcp.secretReenter": [
    "Re-enter the stored secret before renaming it or turning off Sensitive.",
    "Gib das gespeicherte Geheimnis erneut ein, bevor du es umbenennst oder „Vertraulich“ ausschaltest.",
    "Saisissez à nouveau le secret enregistré avant de le renommer ou de désactiver « Sensible ».",
  ],
  "mobile.mcp.invalidConfig": [
    "Check the server fields and their lengths.",
    "Prüfe die Server-Felder und ihre Länge.",
    "Vérifiez les champs du serveur et leur longueur.",
  ],
  "mobile.mcp.invalidJson": [
    "Enter valid JSON.",
    "Gib gültiges JSON ein.",
    "Saisissez du JSON valide.",
  ],
  "mobile.mcp.invalidImport": [
    "JSON must contain an mcpServers object.",
    "Das JSON muss ein mcpServers-Objekt enthalten.",
    "Le JSON doit contenir un objet mcpServers.",
  ],
  "mobile.mcp.requestFailed": [
    "The request failed. Try again.",
    "Die Anfrage ist fehlgeschlagen. Versuche es erneut.",
    "La requête a échoué. Réessayez.",
  ],
  "mobile.mcp.removeEntry": ["Remove", "Entfernen", "Supprimer"],
  "mobile.mcp.argument": ["Argument {{index}}", "Argument {{index}}", "Argument {{index}}"],
  "mobile.mcp.addArgument": ["Add argument", "Argument hinzufügen", "Ajouter un argument"],
  "mobile.mcp.importFrom": ["Import from", "Importieren aus", "Importer depuis"],
  "mobile.mcp.json": ["JSON", "JSON", "JSON"],
  "mobile.mcp.hostSources": [
    "Server configurations",
    "Server-Konfigurationen",
    "Configurations du serveur",
  ],
  "mobile.mcp.pasteJson": ["Paste JSON", "JSON einfügen", "Coller du JSON"],
  "mobile.mcp.chooseFile": ["Choose JSON file", "JSON-Datei auswählen", "Choisir un fichier JSON"],
  "mobile.mcp.export": ["Export", "Exportieren", "Exporter"],
  "mobile.mcp.allScopes": [
    "Include all scopes",
    "Alle Geltungsbereiche einschließen",
    "Inclure toutes les portées",
  ],
  "mobile.mcp.generateExport": ["Generate JSON", "JSON erzeugen", "Générer le JSON"],
  "mobile.mcp.shareJson": ["Share JSON file", "JSON-Datei teilen", "Partager le fichier JSON"],
  "mobile.mcp.clipboardFailed": [
    "Could not copy to the clipboard.",
    "Kopieren in die Zwischenablage fehlgeschlagen.",
    "Impossible de copier dans le presse-papiers.",
  ],
  "mobile.mcp.deleteConfirm": [
    "Delete MCP server ‘{{name}}’?",
    "MCP-Server „{{name}}“ löschen?",
    "Supprimer le serveur MCP « {{name}} » ?",
  ],
  "mobile.mcp.saved": [
    "MCP configuration saved.",
    "MCP-Konfiguration gespeichert.",
    "Configuration MCP enregistrée.",
  ],
  "mobile.mcp.apply.applied": ["Updated now", "Jetzt aktualisiert", "Mis à jour"],
  "mobile.mcp.apply.pending-next-session": [
    "Applies next session",
    "Gilt ab der nächsten Sitzung",
    "S’applique à la prochaine session",
  ],
  "mobile.mcp.apply.unsupported": [
    "Live update unavailable",
    "Live-Aktualisierung nicht verfügbar",
    "Mise à jour en direct indisponible",
  ],
  "mobile.mcp.apply.failed": [
    "Live update failed",
    "Live-Aktualisierung fehlgeschlagen",
    "Échec de la mise à jour en direct",
  ],
  "mobile.mcp.session": ["Session", "Sitzung", "Session"],
  "mobile.mcp.noSessions": [
    "No session is available. Start a thread to see runtime status.",
    "Keine Sitzung verfügbar. Starte einen Thread, um den Laufzeitstatus zu sehen.",
    "Aucune session disponible. Démarrez un fil pour voir l’état d’exécution.",
  ],
  "mobile.mcp.noProviders": [
    "No provider accounts are available.",
    "Keine Anbieter-Konten verfügbar.",
    "Aucun compte fournisseur disponible.",
  ],
  "mobile.mcp.showInventory": [
    "Show tools and resources",
    "Tools und Ressourcen anzeigen",
    "Afficher les outils et ressources",
  ],
  "mobile.mcp.hideInventory": [
    "Hide tools and resources",
    "Tools und Ressourcen ausblenden",
    "Masquer les outils et ressources",
  ],
  "mobile.mcp.openAuthorization": [
    "Open authorization",
    "Autorisierung öffnen",
    "Ouvrir l’autorisation",
  ],
});

export type MobileParityMcpInterfaceMessageKey =
  (typeof mobileParityMcpInterfaceCatalog.keys)[number];
