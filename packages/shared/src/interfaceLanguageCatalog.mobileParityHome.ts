import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for home parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityHomeInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.home.confirm.unpin.one": [
    "Unpin thread?",
    "Chat loslösen?",
    "Désépingler la discussion ?",
  ],
  "mobile.home.confirm.archive.one": [
    "Archive thread?",
    "Chat archivieren?",
    "Archiver la discussion ?",
  ],
  "mobile.home.confirm.delete.one": [
    "Delete thread?",
    "Chat löschen?",
    "Supprimer la discussion ?",
  ],
  "mobile.home.confirm.unpin": [
    "Unpin {{count}} threads?",
    "{{count}} Chats loslösen?",
    "Désépingler {{count}} discussions ?",
  ],
  "mobile.home.confirm.archive": [
    "Archive {{count}} threads?",
    "{{count}} Chats archivieren?",
    "Archiver {{count}} discussions ?",
  ],
  "mobile.home.confirm.delete": [
    "Delete {{count}} threads?",
    "{{count}} Chats löschen?",
    "Supprimer {{count}} discussions ?",
  ],
  "mobile.home.select": ["Select threads", "Chats auswählen", "Sélectionner des discussions"],
  "mobile.home.selected": [
    "{{count}} selected",
    "{{count}} ausgewählt",
    "{{count}} sélectionnée(s)",
  ],
  "mobile.home.selectAll": [
    "Select all shown",
    "Alle angezeigten auswählen",
    "Tout sélectionner dans la liste",
  ],
  "mobile.home.selection.cancel": ["Done selecting", "Auswahl beenden", "Terminer la sélection"],
  "mobile.home.selection.actions": [
    "Selection actions",
    "Aktionen für die Auswahl",
    "Actions de sélection",
  ],
  "mobile.home.selectThread": ["Select thread", "Chat auswählen", "Sélectionner la discussion"],
  "mobile.home.reorderProjects": [
    "Reorder projects",
    "Projekte anordnen",
    "Réorganiser les projets",
  ],
  "mobile.home.projectsSelected": ["{{count}} projects", "{{count}} Projekte", "{{count}} projets"],
  "mobile.home.newThreadInProject": [
    "New thread in {{project}}",
    "Neuer Chat in {{project}}",
    "Nouvelle discussion dans {{project}}",
  ],
  "mobile.home.projectActions": ["Project actions", "Projektaktionen", "Actions du projet"],
  "mobile.home.hiddenThreads": [
    "{{count}} hidden threads",
    "{{count}} ausgeblendete Chats",
    "{{count}} discussions masquées",
  ],
  "mobile.home.indexing": ["Indexing", "Wird indiziert", "Indexation"],
  "mobile.home.guestLink": ["Create guest link", "Gast-Link erstellen", "Créer un lien invité"],
  "mobile.home.copyPromptContext": [
    "Copy prompt link with repo and model",
    "Prompt-Link mit Repository und Modell kopieren",
    "Copier le lien du prompt avec dépôt et modèle",
  ],
  "mobile.home.draft": ["Unsent draft", "Ungesendeter Entwurf", "Brouillon non envoyé"],
  "mobile.home.commandPalette": ["Commands", "Befehle", "Commandes"],
  "mobile.home.searchContents": [
    "Search project contents",
    "Projektinhalte durchsuchen",
    "Rechercher dans le projet",
  ],
  "mobile.home.search.regex": ["Regular expression", "Regulärer Ausdruck", "Expression régulière"],
  "mobile.home.search.case": ["Match case", "Groß-/Kleinschreibung beachten", "Respecter la casse"],
  "mobile.home.search.word": ["Whole word", "Ganzes Wort", "Mot entier"],
  "mobile.home.search.invalidRegex": [
    "Enter a valid regular expression.",
    "Gib einen gültigen regulären Ausdruck ein.",
    "Saisissez une expression régulière valide.",
  ],
  "mobile.home.search.more": [
    "More matches exist. Refine your search.",
    "Es gibt weitere Treffer. Grenze die Suche ein.",
    "D’autres résultats existent. Précisez votre recherche.",
  ],
  "mobile.home.search.tooLong": [
    "Use at most 256 characters.",
    "Verwende höchstens 256 Zeichen.",
    "Utilisez au maximum 256 caractères.",
  ],
  "mobile.home.search.noPermission": [
    "This connection cannot read project files.",
    "Diese Verbindung darf keine Projektdateien lesen.",
    "Cette connexion ne peut pas lire les fichiers du projet.",
  ],
  "mobile.home.search.noResults": [
    "No matching content",
    "Keine passenden Inhalte",
    "Aucun contenu correspondant",
  ],
});

export type MobileParityHomeInterfaceMessageKey =
  (typeof mobileParityHomeInterfaceCatalog.keys)[number];
