import { defineLocalizedInterfaceCatalog } from "./interfaceLanguageCatalog.types.ts";

/** Mobile copy for composer parity work. Keys follow the existing `mobile.*` naming. */
export const mobileParityComposerInterfaceCatalog = defineLocalizedInterfaceCatalog({
  "mobile.composer.multiModelPartial": [
    "{{count}} tasks were queued. Your draft is kept so you can retry the remaining tasks.",
    "{{count}} Aufgaben wurden eingereiht. Dein Entwurf bleibt erhalten, damit du die übrigen Aufgaben erneut starten kannst.",
    "{{count}} tâches ont été mises en file. Votre brouillon est conservé pour réessayer les tâches restantes.",
  ],
  "mobile.composer.sideDescription": [
    "Ask a side question in a new chat",
    "Eine Nebenfrage in einem neuen Chat stellen",
    "Poser une question dans une discussion annexe",
  ],
  "mobile.composer.sideUnavailable": [
    "Side chats are unavailable for this thread or connection.",
    "Nebenchats sind für diesen Chat oder diese Verbindung nicht verfügbar.",
    "Les discussions annexes ne sont pas disponibles pour cette discussion ou cette connexion.",
  ],
  "mobile.composer.sideTextOnly": [
    "Side chats take text only. Remove the attachments and context first.",
    "Nebenchats unterstützen nur Text. Entferne zuerst Anhänge und Kontext.",
    "Les discussions annexes acceptent uniquement du texte. Retirez les pièces jointes et le contexte.",
  ],
  "mobile.composer.sideFailed": [
    "Could not start side chat",
    "Nebenchat konnte nicht gestartet werden",
    "Impossible de lancer la discussion annexe",
  ],
  "mobile.composer.draftsAndHistory": [
    "Drafts and prompt history",
    "Entwürfe und Eingabeverlauf",
    "Brouillons et historique des demandes",
  ],
  "mobile.composer.stash": ["Stash", "Ablage", "Réserve"],
  "mobile.composer.history": ["Prompt history", "Eingabeverlauf", "Historique des demandes"],
  "mobile.composer.stashDraft": [
    "Stash current draft",
    "Aktuellen Entwurf ablegen",
    "Mettre le brouillon de côté",
  ],
  "mobile.composer.restoreDraft": [
    "Restore draft",
    "Entwurf wiederherstellen",
    "Restaurer le brouillon",
  ],
  "mobile.composer.restoreHint": [
    "Restoring a prompt keeps your current draft in the stash.",
    "Beim Wiederherstellen bleibt dein aktueller Entwurf in der Ablage.",
    "La restauration conserve le brouillon actuel dans la réserve.",
  ],
  "mobile.composer.attachmentsOnly": ["Attachments", "Anhänge", "Pièces jointes"],
  "mobile.composer.libraryEmpty": [
    "Nothing saved here yet.",
    "Hier ist noch nichts gespeichert.",
    "Rien d’enregistré ici pour le moment.",
  ],
  "mobile.composer.multipleModels": [
    "Models · {{count}}",
    "Modelle · {{count}}",
    "Modèles · {{count}}",
  ],
  "mobile.composer.multipleModelsHint": [
    "Launch one thread per selected model with the same prompt. Each thread uses its own worktree when selected.",
    "Starte pro ausgewähltem Modell einen Chat mit derselben Eingabe. Bei Worktrees erhält jeder Chat einen eigenen.",
    "Lancez une discussion par modèle avec la même demande. Chaque discussion utilise son propre worktree si ce mode est choisi.",
  ],
  "mobile.composer.modeTitle": ["Composer mode", "Chatmodus", "Mode de saisie"],
  "mobile.composer.modeMenuHint": [
    "Choose how the agent responds.",
    "Wähle, wie der Agent antwortet.",
    "Choisissez la façon dont l’agent répond.",
  ],
  "mobile.composer.buildDescription": [
    "Implement changes and run checks.",
    "Änderungen umsetzen und prüfen.",
    "Réaliser les modifications et les vérifier.",
  ],
  "mobile.composer.planDescription": [
    "Review the approach before implementation.",
    "Vorgehen vor der Umsetzung prüfen.",
    "Examiner l’approche avant la réalisation.",
  ],
  "mobile.composer.deepPlanDescription": [
    "Analyze selected chats and track a reviewed implementation plan.",
    "Ausgewählte Chats analysieren und die Umsetzung eines geprüften Plans verfolgen.",
    "Analyser les discussions sélectionnées et suivre un plan de réalisation validé.",
  ],
  "mobile.composer.deepPlanSingleModel": [
    "Deep Plan supports one model at a time.",
    "Deep Plan unterstützt jeweils ein Modell.",
    "Deep Plan prend en charge un seul modèle à la fois.",
  ],
  "mobile.composer.multiModelNeedsGit": [
    "Choose a Git project and a base branch to launch multiple models.",
    "Wähle ein Git-Projekt und einen Basisbranch, um mehrere Modelle zu starten.",
    "Choisissez un projet Git et une branche de base pour lancer plusieurs modèles.",
  ],
  "mobile.composer.multiModelServer": [
    "Update this server before launching multiple models.",
    "Aktualisiere diesen Server, bevor du mehrere Modelle startest.",
    "Mettez ce serveur à jour avant de lancer plusieurs modèles.",
  ],
  "mobile.composer.chatDescription": [
    "Discuss ideas without starting work.",
    "Ideen besprechen, ohne die Arbeit zu starten.",
    "Discuter des idées sans lancer de travaux.",
  ],
  "mobile.composer.planUnavailable": [
    "This provider does not support Plan mode.",
    "Dieser Anbieter unterstützt den Planmodus nicht.",
    "Ce fournisseur ne prend pas en charge le mode Plan.",
  ],
  "mobile.composer.cost": ["Cost", "Kosten", "Coût"],
  "mobile.composer.autoCompactThreshold": [
    "Compacts automatically at about {{tokens}} tokens.",
    "Komprimiert automatisch bei etwa {{tokens}} Token.",
    "Compression automatique à environ {{tokens}} tokens.",
  ],
  "mobile.composer.compactUnavailable": [
    "Compaction is unavailable while this thread is busy, offline, or read-only.",
    "Komprimieren ist nicht möglich, solange der Chat beschäftigt, offline oder schreibgeschützt ist.",
    "La compression n’est pas disponible si la discussion est occupée, hors ligne ou en lecture seule.",
  ],
  "mobile.composer.compactFailed": [
    "Could not compact context",
    "Kontext konnte nicht komprimiert werden",
    "Impossible de compresser le contexte",
  ],
  "mobile.composer.compactBeforeSend": [
    "Compact {{tokens}} tokens before sending",
    "{{tokens}} Token vor dem Senden komprimieren",
    "Compresser {{tokens}} tokens avant l’envoi",
  ],
  "mobile.composer.keepFullHistory": [
    "Keep full history",
    "Vollständigen Verlauf behalten",
    "Conserver tout l’historique",
  ],
  "mobile.composer.parallelNewThread": [
    "Use {{count}} agents in a new thread",
    "{{count}} Agents in einem neuen Chat verwenden",
    "Utiliser {{count}} agents dans une nouvelle discussion",
  ],
  "mobile.composer.useAgents": [
    "Use {{count}} agents",
    "{{count}} Agents verwenden",
    "Utiliser {{count}} agents",
  ],
  "mobile.composer.sideChatTitle": ["Side chat", "Nebenchat", "Discussion annexe"],
  "mobile.composer.expandPlan": [
    "Show full plan",
    "Vollständigen Plan anzeigen",
    "Afficher le plan complet",
  ],
  "mobile.composer.collapsePlan": ["Collapse plan", "Plan einklappen", "Réduire le plan"],
  "mobile.composer.sharePlan": ["Share Markdown", "Markdown teilen", "Partager le Markdown"],
  "mobile.composer.shareFailed": [
    "Could not share plan",
    "Plan konnte nicht geteilt werden",
    "Impossible de partager le plan",
  ],
  "mobile.composer.openImplementation": [
    "Open implementation chat",
    "Umsetzungschat öffnen",
    "Ouvrir la discussion de réalisation",
  ],
  "mobile.composer.reviewDeepPlan": [
    "Review Deep Plan",
    "Deep Plan prüfen",
    "Examiner le Deep Plan",
  ],
});

export type MobileParityComposerInterfaceMessageKey =
  (typeof mobileParityComposerInterfaceCatalog.keys)[number];
