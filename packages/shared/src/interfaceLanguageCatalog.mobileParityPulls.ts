import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for pulls parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityPullsInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.pulls.sort.ready": [
    "Merge readiness",
    "Zusammenführungsbereitschaft",
    "Prêtes à fusionner",
  ],
  "mobile.pulls.sort.blocked": ["Blocked on me", "Wartet auf mich", "En attente de moi"],
  "mobile.pulls.sort.largest": ["Largest shown", "Größte angezeigte", "Plus volumineuses"],
  "mobile.pulls.sort.smallest": ["Smallest shown", "Kleinste angezeigte", "Moins volumineuses"],
  "mobile.pulls.group.authored": ["Authored", "Von mir erstellt", "Créées par moi"],
  "mobile.pulls.group.reviewRequested": ["Review requested", "Review angefragt", "Revue demandée"],
  "mobile.pulls.group.others": ["Others", "Weitere", "Autres"],
  "mobile.pulls.select": ["Select", "Auswählen", "Sélectionner"],
  "mobile.pulls.selectAll": [
    "Select all open",
    "Alle offenen auswählen",
    "Sélectionner toutes les ouvertes",
  ],
  "mobile.pulls.closeSelected": [
    "Close selected ({count})",
    "Auswahl schließen ({count})",
    "Fermer la sélection ({count})",
  ],
  "mobile.pulls.closeConfirm": [
    "Close {count} requests?",
    "{count} Anfragen schließen?",
    "Fermer {count} demandes ?",
  ],
  "mobile.pulls.closeFailed": [
    "{count} requests could not be closed. They remain selected.",
    "{count} Anfragen konnten nicht geschlossen werden. Sie bleiben ausgewählt.",
    "Impossible de fermer {count} demandes. Elles restent sélectionnées.",
  ],
  "mobile.pulls.logs.truncated": [
    "Showing the latest 256 KiB. Open the provider for the full log.",
    "Die letzten 256 KiB werden angezeigt. Das vollständige Protokoll beim Anbieter öffnen.",
    "Affichage des derniers 256 Kio. Ouvrez le fournisseur pour le journal complet.",
  ],
  "mobile.pulls.logs.loading": [
    "Loading job log…",
    "Job-Protokoll wird geladen…",
    "Chargement du journal…",
  ],
  "mobile.pulls.logs.empty": [
    "No log output is available for this job.",
    "Für diesen Job ist keine Protokollausgabe verfügbar.",
    "Aucune sortie de journal pour cette tâche.",
  ],
  "mobile.pulls.logs.waiting": [
    "Waiting for job output…",
    "Warten auf Job-Ausgabe…",
    "En attente de la sortie…",
  ],
  "mobile.pulls.logs.finished": ["Job finished", "Job abgeschlossen", "Tâche terminée"],
  "mobile.pulls.logs.live": [
    "Live · updates every 5 seconds",
    "Live · Aktualisierung alle 5 Sekunden",
    "En direct · actualisation toutes les 5 secondes",
  ],
  "mobile.pulls.logs.follow": ["Follow output", "Ausgabe folgen", "Suivre la sortie"],
  "mobile.pulls.logs.pause": ["Pause following", "Folgen pausieren", "Suspendre le suivi"],
  "mobile.pulls.logs.retrying": [
    "Retrying every 15 seconds",
    "Neuer Versuch alle 15 Sekunden",
    "Nouvelle tentative toutes les 15 secondes",
  ],
  "mobile.pulls.comment.rangeHint": [
    "Long-press the first line, then tap the last line to select a range.",
    "Erste Zeile gedrückt halten, dann die letzte Zeile antippen, um einen Bereich auszuwählen.",
    "Appuyez longuement sur la première ligne, puis touchez la dernière pour sélectionner une plage.",
  ],
  "mobile.pulls.guide.progress": [
    "{read} of {count} stops read",
    "{read} von {count} Stationen gelesen",
    "{read} étapes lues sur {count}",
  ],
  "mobile.pulls.guide.read": ["Read", "Gelesen", "Lue"],
  "mobile.pulls.guide.markRead": ["Mark read", "Als gelesen markieren", "Marquer comme lue"],
  "mobile.pulls.guide.markUnread": [
    "Mark unread",
    "Als ungelesen markieren",
    "Marquer comme non lue",
  ],
  "mobile.pulls.guide.resume": ["Resume tour", "Tour fortsetzen", "Reprendre la visite"],
  "mobile.pulls.guide.askAgent": ["Ask agent", "Agent fragen", "Demander à l’agent"],
  "mobile.pulls.guide.askPrompt": [
    "Explain this review guide context and help me assess it.",
    "Erkläre diesen Kontext aus dem Review-Leitfaden und hilf mir, ihn zu beurteilen.",
    "Explique ce contexte du guide de revue et aide-moi à l’évaluer.",
  ],
  "mobile.pulls.guide.ready": [
    "Review guide ready",
    "Review-Leitfaden bereit",
    "Guide de revue prêt",
  ],
  "mobile.pulls.guide.failed": [
    "Review guide failed",
    "Review-Leitfaden fehlgeschlagen",
    "Échec du guide de revue",
  ],
  "mobile.pulls.guide.open": ["Open guide", "Leitfaden öffnen", "Ouvrir le guide"],
  "mobile.pulls.stack.rebase": [
    "Rebase whole stack",
    "Gesamten Stack rebasen",
    "Rebaser toute la pile",
  ],
  "mobile.pulls.stack.rebaseConfirm": [
    "Rebase all {count} unmerged layers onto {base}? The operation stops at the first conflict.",
    "Alle {count} noch nicht zusammengeführten Ebenen auf {base} rebasen? Der Vorgang stoppt beim ersten Konflikt.",
    "Rebaser les {count} couches non fusionnées sur {base} ? L’opération s’arrête au premier conflit.",
  ],
  "mobile.pulls.stack.rebaseFailed": [
    "Could not rebase the stack",
    "Stack konnte nicht rebasiert werden",
    "Impossible de rebaser la pile",
  ],
  "mobile.pulls.stack.rebased": ["Stack rebased", "Stack rebasiert", "Pile rebasée"],
  "mobile.pulls.work.environment": [
    "Act on {environment}",
    "Auf {environment} ausführen",
    "Agir sur {environment}",
  ],
  "mobile.pulls.checkout.here": ["Check out here", "Hier auschecken", "Extraire ici"],
  "mobile.pulls.checkout.worktree": [
    "Check out in separate worktree",
    "In separatem Worktree auschecken",
    "Extraire dans un worktree séparé",
  ],
  "mobile.pulls.checkout.confirm": [
    "Switch the working branch in {path} on {environment}?",
    "Arbeitsbranch in {path} auf {environment} wechseln?",
    "Changer la branche de travail dans {path} sur {environment} ?",
  ],
  "mobile.pulls.checkout.failed": [
    "Could not check out this request",
    "Anfrage konnte nicht ausgecheckt werden",
    "Impossible d’extraire cette demande",
  ],
  "mobile.pulls.checkout.ready": ["Checkout ready", "Checkout bereit", "Extraction prête"],
  "mobile.pulls.checkout.offHead": [
    "Local changes prevented updating to the request’s head. Resolve them before working on it.",
    "Lokale Änderungen verhindern die Aktualisierung auf den Stand der Anfrage. Diese zuerst auflösen.",
    "Des modifications locales empêchent la mise à jour vers la tête de la demande. Résolvez-les avant de continuer.",
  ],
});

export type MobileParityPullsInterfaceMessageKey =
  (typeof mobileParityPullsInterfaceCatalog.keys)[number];
