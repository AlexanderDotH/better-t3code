import { Atom, AsyncResult } from "effect/reactivity";
import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { mobilePreferencesAtom } from "../../state/preferences";
import { composerDraftsAtom } from "../../state/use-composer-drafts";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";

export const boringMultilineRowsAtom = Atom.make((get) => {
  const result = get(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(result) || result.value.boringThreadListEnabled !== true) return null;
  return (
    result.value.boringThreadListMultilineRows ??
    MOBILE_CLIENT_PREFERENCE_DEFAULTS.boringThreadListMultilineRows
  );
});

export const threadHasDraftAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const result = get(mobilePreferencesAtom);
    const settings = AsyncResult.isSuccess(result)
      ? (result.value.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1)
      : DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1;
    if (!resolveBetterT3FeatureFlag(settings, "chat.draftIndicators")) return false;
    const draft = get(composerDraftsAtom)[key];
    return (
      draft !== undefined &&
      (draft.text.trim().length > 0 ||
        draft.attachments.length > 0 ||
        (draft.context?.records.length ?? 0) > 0 ||
        (draft.voiceFileReferences?.length ?? 0) > 0)
    );
  }),
);
