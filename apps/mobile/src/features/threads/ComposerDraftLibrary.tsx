import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { composerDraftsAtom, setComposerDraftText } from "../../state/use-composer-drafts";
import {
  composerPromptHistory,
  deleteComposerStash,
  listComposerStashes,
  restoreComposerStash,
  stashComposerDraft,
} from "../../state/composer-library";
import { ThreadDetailSheet } from "./ThreadDetailSheet";

export function ComposerDraftLibrary(props: {
  readonly draftKey: string;
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
}) {
  const translator = useMobileInterfaceTranslator();
  const drafts = useAtomValue(composerDraftsAtom);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"stash" | "history">("stash");
  const [history, setHistory] = useState<ReadonlyArray<string>>([]);
  const stashes = useMemo(
    () => listComposerStashes(drafts, props.draftKey, props.environmentId),
    [drafts, props.draftKey, props.environmentId],
  );
  const current = drafts[props.draftKey];
  return (
    <>
      <ComposerInlineControl
        label={translator.message("mobile.composer.draftsAndHistory")}
        icon="clock.arrow.circlepath"
        iconOnly
        disabled={props.disabled}
        onPress={() => {
          setHistory(composerPromptHistory(props.messages));
          setOpen(true);
        }}
      />
      {open ? (
        <ThreadDetailSheet
          title={translator.message("mobile.composer.draftsAndHistory")}
          onClose={() => setOpen(false)}
        >
          <View className="gap-3">
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={translator.message("mobile.composer.stash")}
                tone={tab === "stash" ? "primary" : "secondary"}
                onPress={() => setTab("stash")}
              />
              <Button
                label={translator.message("mobile.composer.history")}
                tone={tab === "history" ? "primary" : "secondary"}
                onPress={() => setTab("history")}
              />
            </View>
            <Button
              label={translator.message("mobile.composer.stashDraft")}
              disabled={props.disabled || (!current?.text.trim() && !current?.attachments.length)}
              onPress={() => stashComposerDraft(props.draftKey, props.environmentId)}
            />
            <Text className="text-xs text-foreground-muted">
              {translator.message("mobile.composer.restoreHint")}
            </Text>
            {tab === "stash"
              ? stashes.map((entry) => (
                  <View
                    key={entry.key}
                    className="flex-row items-center gap-2 border-b border-border py-2"
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={translator.message("mobile.composer.restoreDraft")}
                      className="min-h-11 flex-1 justify-center"
                      onPress={() => {
                        restoreComposerStash(props.draftKey, entry.key, props.environmentId);
                        setOpen(false);
                      }}
                    >
                      <Text numberOfLines={3} className="text-sm text-foreground">
                        {entry.draft.text || translator.message("mobile.composer.attachmentsOnly")}
                      </Text>
                      <Text className="text-xs text-foreground-muted">
                        {translator.number(entry.draft.attachments.length)} ·{" "}
                        {translator.date(entry.createdAt)}
                      </Text>
                    </Pressable>
                    <Button
                      label={translator.message("settings.common.delete")}
                      tone="text"
                      onPress={() =>
                        deleteComposerStash(props.draftKey, entry.key, props.environmentId)
                      }
                    />
                  </View>
                ))
              : history.map((text) => (
                  <Pressable
                    key={text}
                    accessibilityRole="button"
                    className="min-h-11 border-b border-border py-3"
                    onPress={() => {
                      stashComposerDraft(props.draftKey, props.environmentId);
                      setComposerDraftText(props.draftKey, text);
                      setOpen(false);
                    }}
                  >
                    <Text numberOfLines={4} className="text-sm text-foreground">
                      {text}
                    </Text>
                  </Pressable>
                ))}
            {(tab === "stash" ? stashes.length : history.length) === 0 ? (
              <Text className="py-3 text-sm text-foreground-muted">
                {translator.message("mobile.composer.libraryEmpty")}
              </Text>
            ) : null}
          </View>
        </ThreadDetailSheet>
      ) : null}
    </>
  );
}
