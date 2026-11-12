import { useNavigation } from "@react-navigation/native";
import { canDetachThreadProviderSession } from "@t3tools/client-runtime/state/thread-workflows";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import { useAtomCommand } from "../../state/use-atom-command";
import { ThreadDetailsPanel } from "./ThreadDetailsPanel";
import { useThreadGuestSharing } from "./useThreadGuestSharing";
import { useEnvironmentScope } from "../../state/session";

export function useThreadHeaderPanels(threadRef: ScopedThreadRef | null, title: string) {
  const t = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(threadRef?.environmentId ?? null);
  const structure = useQuietThreadStructure(threadRef);
  const rename = useAtomCommand(threadEnvironment.updateMetadata);
  const disconnect = useAtomCommand(threadEnvironment.stopSession);
  const canRename = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canDisconnect = canRename;
  const sharing = useThreadGuestSharing(threadRef);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const identity = JSON.stringify(threadRef);
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (identity !== previousIdentity) {
    setPreviousIdentity(identity);
    setRenameDraft(null);
    setDetailsOpen(false);
  }
  const saveTitle = async () => {
    const nextTitle = renameDraft?.trim();
    if (!threadRef || !nextTitle || !canRename || busy.current) return;
    busy.current = true;
    setPending(true);
    await (async () => {
      const result = await rename({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: nextTitle },
      });
      if (result._tag === "Success") {
        setRenameDraft(null);
        Keyboard.dismiss();
      } else {
        const error = squashAtomCommandFailure(result);
        Dialog.alert(
          t.message("mobile.panels.failed"),
          error instanceof Error ? error.message : String(error),
        );
      }
    })().finally(() => {
      busy.current = false;
      setPending(false);
    });
  };
  const items: Extract<AppBarMenuItem, { readonly onPress: () => void }>[] = threadRef
    ? [
        {
          id: "rename-thread",
          title: t.message("mobile.panels.rename"),
          icon: "pencil",
          disabled: !canRename || pending,
          onPress: () => setRenameDraft(title),
        },
        {
          id: "thread-details",
          title: t.message("mobile.panels.details"),
          icon: "info.circle",
          onPress: () => {
            Keyboard.dismiss();
            setDetailsOpen(true);
          },
        },
        {
          id: "thread-browser",
          title: t.message("settings.integrations.browser"),
          icon: "globe",
          disabled: config?.environment.capabilities.serverBrowser !== true,
          onPress: () => {
            Keyboard.dismiss();
            navigation.navigate("ThreadBrowserPreview", threadRef);
          },
        },
        {
          id: "thread-devices",
          title: t.message("settings.providers.panel.devices"),
          icon: "iphone",
          onPress: () => {
            Keyboard.dismiss();
            navigation.navigate("ThreadDevicePreview", threadRef);
          },
        },
        {
          id: "thread-guest-share",
          title: t.message(
            structure?.projection.thread.guestShare
              ? "mobile.panels.copyGuest"
              : "mobile.panels.shareGuest",
          ),
          icon: "person.badge.plus",
          disabled: !sharing.allowed || sharing.pending,
          onPress: () => void sharing.createAndCopy(),
        },
        {
          id: "thread-disconnect",
          title: t.message("mobile.panels.disconnect"),
          icon: "bolt.slash",
          disabled:
            pending ||
            !canDisconnect ||
            !structure ||
            !canDetachThreadProviderSession(structure.projection),
          onPress: () =>
            Dialog.confirm({
              title: t.message("mobile.panels.disconnect"),
              message: t.message("mobile.panels.disconnectHint"),
              confirmText: t.message("mobile.panels.disconnect"),
              onConfirm: () => {
                if (busy.current || !canDisconnect) return;
                busy.current = true;
                setPending(true);
                void disconnect({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId },
                })
                  .then((result) => {
                    if (result._tag === "Failure") Dialog.alert(t.message("mobile.panels.failed"));
                  })
                  .finally(() => {
                    busy.current = false;
                    setPending(false);
                  });
              },
            }),
        },
      ]
    : [];
  return {
    items,
    editor:
      renameDraft === null ? null : (
        <View className="flex-row items-center gap-2 bg-header px-4 pb-2">
          <AppTextInput
            accessibilityLabel={t.message("mobile.panels.rename")}
            autoFocus
            maxLength={512}
            selectTextOnFocus
            value={renameDraft}
            onChangeText={setRenameDraft}
            editable={!pending}
            returnKeyType="done"
            onSubmitEditing={() => void saveTitle()}
            className="min-w-0 flex-1 rounded-xl border border-input-border bg-input px-3 py-2 text-foreground"
          />
          <Button
            label={t.message("settings.common.save")}
            disabled={!renameDraft.trim() || pending}
            onPress={() => void saveTitle()}
          />
          <Button
            label={t.message("common.cancel")}
            tone="text"
            disabled={pending}
            onPress={() => setRenameDraft(null)}
          />
        </View>
      ),
    panel:
      detailsOpen && threadRef ? (
        <ThreadDetailsPanel
          key={identity}
          threadRef={threadRef}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null,
  };
}
