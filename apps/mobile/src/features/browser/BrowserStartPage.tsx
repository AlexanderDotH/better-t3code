import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import * as Dialog from "../../components/ui/Dialog";
import { previewEnvironment } from "../../state/preview";
import { useBrowserSearchSettings } from "./useBrowserSearchSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { browserAddress } from "./browserAddress";
import { useBrowserHistory } from "./browserHistory";

export function BrowserStartPage(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onOpen: (tabId: string) => void;
}) {
  const t = useMobileInterfaceTranslator();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = useBrowserSearchSettings();
  const canOpen = useAtomValue(previewEnvironment.open.permissionAtom(props.environmentId));
  const open = useAtomCommand(previewEnvironment.open);
  const discovered = useEnvironmentQuery(
    previewEnvironment.discoveredServers({ environmentId: props.environmentId, input: {} }),
  );
  const servers = discovered.data?.servers ?? [];
  const history = useBrowserHistory(props.environmentId);
  const openUrl = async (raw: string) => {
    if (busy || !canOpen) return;
    await (async () => {
      const url = browserAddress(raw, settings);
      setBusy(true);
      const result = await open({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, runtime: "server", url },
      });
      if (result._tag === "Success") {
        history.remember(url);
        props.onOpen(result.value.tabId);
      } else Dialog.alert(t.message("mobile.panels.failed"));
    })()
      .catch((error) => {
        Dialog.alert(
          t.message("mobile.ui.couldNotOpenThisAddress"),
          error instanceof Error ? error.message : undefined,
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4">
      <View className="flex-row items-center gap-2">
        <AppTextInput
          accessibilityLabel={t.message("mobile.panels.address")}
          placeholder={t.message("mobile.panels.address")}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          editable={!busy && canOpen}
          onSubmitEditing={() => void openUrl(address)}
          className="min-w-0 flex-1 rounded-xl border border-input-border bg-input px-3 py-3 text-foreground"
        />
        <Button
          label={t.message("mobile.panels.open")}
          disabled={busy || !canOpen || !address.trim()}
          onPress={() => void openUrl(address)}
        />
      </View>
      <AppText className="text-sm text-foreground-muted">
        {t.message("mobile.panels.browserEmpty")}
      </AppText>
      {history.urls.length > 0 ? (
        <>
          <AppText className="font-t3-semibold">{t.message("mobile.panels.recent")}</AppText>
          {history.urls.map((url) => (
            <ListRow
              key={url}
              icon="clock"
              label={url}
              disabled={busy || !canOpen}
              onPress={() => void openUrl(url)}
            />
          ))}
        </>
      ) : null}
      <AppText className="font-t3-semibold">{t.message("mobile.panels.localServers")}</AppText>
      {discovered.error ? (
        <AppText selectable className="text-sm text-foreground-muted">
          {discovered.error}
        </AppText>
      ) : null}
      {servers.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.panels.noServers")}
        </AppText>
      ) : (
        servers.map((server) => (
          <ListRow
            key={`${server.host}:${server.port}`}
            icon="globe"
            label={server.url}
            description={[server.processName, server.pid].filter(Boolean).join(" · ")}
            disabled={busy || !canOpen}
            onPress={() => void openUrl(server.url)}
          />
        ))
      )}
    </ScrollView>
  );
}
