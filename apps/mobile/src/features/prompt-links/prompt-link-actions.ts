import * as Dialog from "../../components/ui/Dialog";
import { buildNewThreadLink, type LinkedPrompt } from "@t3tools/shared/promptLinks";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  getComposerDraftSnapshot,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { linkedThreadDraftAction } from "./prompt-link-model";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export function showPromptLinkNotice(notice: string): void {
  Dialog.alert(currentInterfaceTranslator().message("mobile.ui.promptFromALink"), notice);
}

export async function applyLinkedPromptToThreadDraft(
  draftKey: string,
  prompt: LinkedPrompt,
  notice: string,
): Promise<void> {
  try {
    await waitForComposerDraftsLoaded();
  } catch {
    Dialog.alert(
      currentInterfaceTranslator().message("mobile.ui.couldNotOpenLink"),
      currentInterfaceTranslator().message("mobile.ui.draftsCouldNotBeLoadedSoThe"),
    );
    return;
  }
  const action = linkedThreadDraftAction(getComposerDraftSnapshot(draftKey).text, prompt.text);
  if (action !== "ask") {
    if (action === "fill") setComposerDraftText(draftKey, prompt.text);
    showPromptLinkNotice(notice);
    return;
  }
  Dialog.alert(
    currentInterfaceTranslator().message("mobile.ui.linkedPromptReadyReplaceDraft"),
    notice,
    [
      { text: currentInterfaceTranslator().message("mobile.ui.keepMine"), style: "cancel" },
      {
        text: currentInterfaceTranslator().message("mobile.ui.replace"),
        onPress: () => setComposerDraftText(draftKey, prompt.text),
      },
    ],
  );
}

export async function copyPromptLink(prompt: string): Promise<void> {
  if (!(await tryCopyTextWithHaptic(buildNewThreadLink({ prompt }), { target: "prompt link" }))) {
    Dialog.alert(
      currentInterfaceTranslator().message("mobile.ui.couldNotCopy"),
      currentInterfaceTranslator().message("settings.panels.tryAgain"),
    );
  }
}
