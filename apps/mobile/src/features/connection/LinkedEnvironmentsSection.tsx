import { offersLinkedEnvironments } from "@t3tools/client-runtime/link-request";
import { useAtomValue } from "@effect/atom-react";
import { peerLinkHealth } from "@t3tools/client-runtime/state/peerLinks";
import { useFocusEffect } from "@react-navigation/native";
import { AuthAccessReadScope, type EnvironmentId, type PeerLinkSummary } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useCallback, useState } from "react";
import { Alert, AppState, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentServerConfig } from "../../state/entities";
import { peerLinkEnvironment } from "../../state/peerLinks";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { useAtomCommand } from "../../state/use-atom-command";
import { LinkEnvironmentSheet } from "./LinkEnvironmentSheet";
import { RUNTIME_MODE_CHOICES } from "../threads/thread-settings-options";

export function LinkedEnvironmentsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  const canRead = useEnvironmentScope(props.environmentId, AuthAccessReadScope);
  const supported = canRead && offersLinkedEnvironments(config);
  const links = useEnvironmentQuery(
    supported ? peerLinkEnvironment.list({ environmentId: props.environmentId, input: {} }) : null,
  );
  const mayLink = useAtomValue(peerLinkEnvironment.link.permissionAtom(props.environmentId));
  const mayUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(props.environmentId));
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { reportFailure: false });
  const [editing, setEditing] = useState<"new" | PeerLinkSummary | null>(null);
  const [pending, setPending] = useState<EnvironmentId | null>(null);
  const [error, setError] = useState(false);
  const forget = (link: PeerLinkSummary) =>
    Alert.alert(
      translator.message("mobile.access.forgetTitle", { label: link.label }),
      translator.message("mobile.access.forgetHint", { label: link.label }),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.access.forget"),
          style: "destructive",
          onPress: () => {
            if (pending !== null || !mayUnlink) return;
            setPending(link.environmentId);
            setError(false);
            void unlink({
              environmentId: props.environmentId,
              input: { environmentId: link.environmentId },
            }).then((result) => {
              setError(result._tag !== "Success");
              setPending(null);
            });
          },
        },
      ],
    );
  const [nowMs, setNowMs] = useState(Date.now);
  const hasLinks = supported && (links.data?.links.length ?? 0) > 0;
  useFocusEffect(
    useCallback(() => {
      if (!hasLinks) return;
      const updateNow = () => setNowMs(Date.now());
      updateNow();
      const timer = setInterval(updateNow, 60_000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") updateNow();
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [hasLinks]),
  );
  if (!supported) return null;
  const now = DateTime.makeUnsafe(nowMs);
  return (
    <View className="mt-5 gap-3">
      <SettingsSection
        title={translator.message("mobile.access.linkedFrom", { label: props.environmentLabel })}
      >
        <ListActionRow
          icon="plus"
          label={translator.message("mobile.access.linkEnvironment")}
          disabled={!mayLink || pending !== null}
          onPress={() => setEditing("new")}
        />
        {links.error ? (
          <ListActionRow
            icon="arrow.clockwise"
            label={translator.message("mobile.access.loadFailed")}
            onPress={links.refresh}
          />
        ) : null}
        {links.data?.links.length === 0 ? (
          <Text className="p-4 text-foreground-muted">
            {translator.message("mobile.access.noLinks")}
          </Text>
        ) : null}
        {links.data?.links.map((link) => {
          const health = peerLinkHealth(link, now);
          const status =
            health.kind === "expired"
              ? translator.message("mobile.access.linkExpired")
              : health.kind === "unreachable"
                ? (health.detail ?? translator.message("mobile.access.unreachable"))
                : health.kind === "failing"
                  ? health.detail
                  : health.expiresInDays !== null
                    ? translator.message("mobile.access.expiresDays", {
                        days: health.expiresInDays,
                      })
                    : translator.message("mobile.ui.reachable");
          return (
            <View key={link.environmentId} className="gap-0.5 p-4">
              <Text className="text-base font-t3-bold text-foreground">{link.label}</Text>
              <Text
                className={
                  health.kind === "reachable" && health.expiresInDays === null
                    ? "text-xs text-foreground-muted"
                    : "text-xs text-danger-foreground"
                }
                numberOfLines={2}
              >
                {status}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {link.access === "read-only"
                  ? translator.message("settings.connections.readOnly")
                  : (RUNTIME_MODE_CHOICES.find((mode) => mode.mode === link.access)?.label ??
                    link.access)}{" "}
                · {link.urls.join(", ")}
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Button
                  label={translator.message("mobile.access.renew")}
                  disabled={!mayLink || pending !== null}
                  onPress={() => setEditing(link)}
                />
                <Button
                  label={translator.message("mobile.access.forget")}
                  tone="danger"
                  disabled={!mayUnlink || pending !== null}
                  onPress={() => forget(link)}
                />
              </View>
            </View>
          );
        })}
        {error ? (
          <Text accessibilityRole="alert" className="p-4 text-danger-foreground">
            {translator.message("mobile.access.mutationFailed")}
          </Text>
        ) : null}
      </SettingsSection>
      {editing ? (
        <LinkEnvironmentSheet
          environmentId={props.environmentId}
          {...(editing === "new" ? {} : { initialTarget: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}
