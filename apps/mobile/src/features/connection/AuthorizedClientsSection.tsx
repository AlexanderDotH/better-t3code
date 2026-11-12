import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthEnvironmentScope,
  type AuthGrantScope,
  type AuthPairingCredentialResult,
  type EnvironmentId,
  managedCapabilityDenial,
} from "@t3tools/contracts";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Alert, Share, View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import {
  environmentSession,
  useEnvironmentScope,
  usePreparedConnection,
} from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { AccessSheet } from "./AccessSheet";
import { ConnectionFormField } from "./ConnectionFormField";
import { authAccess, authEnvironment } from "./access-state";
import { accessScopeCopy } from "./access-scope-copy";
import {
  pairingScopePreset,
  pairingScopesForSession,
  shareablePairingUrl,
  togglePairingScope,
} from "./access-settings";

export function AuthorizedClientsSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const translator = useMobileInterfaceTranslator();
  const canRead = useEnvironmentScope(environmentId, AuthAccessReadScope);
  const canWrite = useAtomValue(authAccess.revokeClient.permissionAtom(environmentId));
  const config = useEnvironmentServerConfig(environmentId);
  const denial = managedCapabilityDenial(config?.managedPolicy, "remoteClients");
  const access = useEnvironmentQuery(
    canRead ? authEnvironment.accessChanges({ environmentId, input: null }) : null,
  );
  const revokeClient = useAtomCommand(authAccess.revokeClient, {
    reportFailure: false,
    reportDefect: false,
  });
  const revokeOthers = useAtomCommand(authAccess.revokeOthers, {
    reportFailure: false,
    reportDefect: false,
  });
  const revokePairing = useAtomCommand(authAccess.revokePairing, {
    reportFailure: false,
    reportDefect: false,
  });
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const [scopes, setScopes] = useState<ReadonlyArray<AuthEnvironmentScope> | null>(null);

  async function revoke(action: () => Promise<{ readonly _tag: string }>) {
    if (inFlight.current || !canWrite) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    const result = await action();
    setError(result._tag !== "Success");
    inFlight.current = false;
    setPending(false);
  }
  function confirmRevoke(label: string, action: () => Promise<{ readonly _tag: string }>) {
    Alert.alert(translator.message("mobile.access.revokeTitle"), label, [
      { text: translator.message("common.cancel"), style: "cancel" },
      {
        text: translator.message("mobile.access.revoke"),
        style: "destructive",
        onPress: () => void revoke(action),
      },
    ]);
  }
  if (!canRead) return null;

  return (
    <>
      <SettingsSection title={translator.message("mobile.access.authorizedClients")}>
        {access.error ? (
          <ListActionRow
            icon="arrow.clockwise"
            label={translator.message("mobile.access.loadFailed")}
            onPress={access.refresh}
          />
        ) : !access.data ? (
          <AppText className="p-4 text-foreground-muted">
            {translator.message("mobile.access.loading")}
          </AppText>
        ) : (
          <>
            {access.data.payload.clientSessions.map(({ client: metadata, ...client }) => {
              const label =
                metadata.label ??
                ([metadata.os, metadata.browser].filter(Boolean).join(" · ") || client.subject);
              return (
                <View key={client.sessionId} className="gap-2 p-4">
                  <AppText className="font-t3-medium text-foreground">{label}</AppText>
                  <AppText className="text-sm text-foreground-muted">
                    {client.current
                      ? translator.message("mobile.access.thisDevice")
                      : client.connected
                        ? translator.message("mobile.access.connected")
                        : translator.message("mobile.access.disconnected")}
                    {client.lastConnectedAt
                      ? ` · ${DateTime.toDate(client.lastConnectedAt).toLocaleString()}`
                      : ""}
                  </AppText>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={translator.message("mobile.access.permissions")}
                      tone="text"
                      onPress={() => setScopes(client.permissions ?? client.scopes)}
                    />
                    {!client.current ? (
                      <Button
                        label={translator.message("mobile.access.revoke")}
                        tone="danger"
                        disabled={!canWrite || pending}
                        onPress={() =>
                          confirmRevoke(label, () =>
                            revokeClient({ environmentId, input: { sessionId: client.sessionId } }),
                          )
                        }
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
            {access.data.payload.clientSessions.length === 0 ? (
              <AppText className="p-4 text-foreground-muted">
                {translator.message("mobile.access.noClients")}
              </AppText>
            ) : null}
            <ListActionRow
              icon="person.2"
              label={translator.message("mobile.access.revokeOthers")}
              disabled={
                !canWrite ||
                pending ||
                !access.data.payload.clientSessions.some((client) => !client.current)
              }
              onPress={() =>
                confirmRevoke(translator.message("mobile.access.revokeOthersHint"), () =>
                  revokeOthers({ environmentId, input: null }),
                )
              }
            />
          </>
        )}
      </SettingsSection>
      <SettingsSection title={translator.message("mobile.access.pairingLinks")} footer={denial}>
        <ListActionRow
          icon="plus"
          label={translator.message("mobile.access.createLink")}
          disabled={!canWrite || pending || denial !== undefined}
          onPress={() => setCreating(true)}
        />
        {access.data?.payload.pairingLinks.map((link) => (
          <View key={link.id} className="gap-2 p-4">
            <AppText className="font-t3-medium text-foreground">
              {link.label ?? translator.message("mobile.access.pairingLink")}
            </AppText>
            <AppText className="text-sm text-foreground-muted">
              {translator.message("mobile.access.expires", {
                date: DateTime.toDate(link.expiresAt).toLocaleString(),
              })}
            </AppText>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={translator.message("mobile.access.permissions")}
                tone="text"
                onPress={() => setScopes(link.permissions ?? link.scopes)}
              />
              <Button
                label={translator.message("mobile.access.revoke")}
                tone="danger"
                disabled={!canWrite || pending}
                onPress={() =>
                  confirmRevoke(link.label ?? translator.message("mobile.access.pairingLink"), () =>
                    revokePairing({ environmentId, input: { id: link.id } }),
                  )
                }
              />
            </View>
          </View>
        ))}
        {error ? (
          <AppText accessibilityRole="alert" className="p-4 text-danger-foreground">
            {translator.message("mobile.access.mutationFailed")}
          </AppText>
        ) : null}
      </SettingsSection>
      {creating ? (
        <CreatePairingSheet environmentId={environmentId} onClose={() => setCreating(false)} />
      ) : null}
      {scopes !== null ? (
        <AccessSheet
          title={translator.message("mobile.access.permissions")}
          onClose={() => setScopes(null)}
        >
          {scopes.map((scope) => {
            const option = AUTH_SCOPE_OPTIONS.find((option) => option.scope === scope);
            return (
              <AppText key={scope} className="text-foreground">
                {option ? translator.message(accessScopeCopy[option.scope][0]) : scope}
              </AppText>
            );
          })}
        </AccessSheet>
      ) : null}
    </>
  );
}

function CreatePairingSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const session = useAtomValue(environmentSession.sessionStateValueAtom(props.environmentId));
  const canWrite = useAtomValue(authAccess.createPairing.permissionAtom(props.environmentId));
  const config = useEnvironmentServerConfig(props.environmentId);
  const denial = managedCapabilityDenial(config?.managedPolicy, "remoteClients");
  const prepared = usePreparedConnection(props.environmentId);
  const create = useAtomCommand(authAccess.createPairing, {
    reportFailure: false,
    reportDefect: false,
  });
  const revoke = useAtomCommand(authAccess.revokePairing, {
    reportFailure: false,
    reportDefect: false,
  });
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<ReadonlyArray<AuthGrantScope>>(() =>
    pairingScopesForSession(session, pairingScopePreset("standard")),
  );
  const [created, setCreated] = useState<AuthPairingCredentialResult | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const scopes = pairingScopesForSession(session, selected);
  const address = Option.isSome(prepared) ? prepared.value.httpBaseUrl : "";
  const url = created ? shareablePairingUrl(address, created.credential) : null;

  async function submit() {
    if (inFlight.current || !canWrite || scopes.length === 0 || denial !== undefined) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    const result = await create({
      environmentId: props.environmentId,
      input: { ...(label.trim() ? { label: label.trim() } : {}), scopes },
    });
    if (result._tag === "Success") setCreated(result.value);
    else setError(true);
    inFlight.current = false;
    setPending(false);
  }
  async function share(copy: boolean, codeOnly = false) {
    if (!created) return;
    await (async () => {
      const value = codeOnly ? created.credential : (url ?? created.credential);
      if (copy) {
        await Clipboard.setStringAsync(value);
        setCopied(true);
      } else {
        await Share.share({ message: value });
      }
    })().catch(() => {
      setError(true);
    });
  }
  async function revokeCreated() {
    if (!created || inFlight.current || !canWrite) return;
    inFlight.current = true;
    setPending(true);
    const result = await revoke({ environmentId: props.environmentId, input: { id: created.id } });
    if (result._tag === "Success") props.onClose();
    else setError(true);
    setPending(false);
    inFlight.current = false;
  }
  return (
    <AccessSheet
      title={translator.message("mobile.access.createLink")}
      busy={pending}
      onClose={props.onClose}
    >
      {created ? (
        <>
          <AppText className="text-foreground-muted">
            {translator.message("mobile.access.shareOnce")}
          </AppText>
          <AppText className="text-foreground-muted">
            {translator.message("mobile.access.expires", {
              date: DateTime.toDate(created.expiresAt).toLocaleString(),
            })}
          </AppText>
          <Button
            label={translator.message("mobile.access.share")}
            icon="square.and.arrow.up"
            onPress={() => void share(false)}
            disabled={pending}
          />
          <Button
            label={translator.message(url ? "mobile.access.copy" : "mobile.access.copyCode")}
            icon="doc.on.doc"
            onPress={() => void share(true)}
            disabled={pending}
          />
          {url ? (
            <Button
              label={translator.message("mobile.access.copyCode")}
              tone="text"
              onPress={() => void share(true, true)}
              disabled={pending}
            />
          ) : null}
          {copied ? (
            <AppText className="text-foreground-muted">
              {translator.message("mobile.access.copied")}
            </AppText>
          ) : null}
          <Button
            label={translator.message("mobile.access.revoke")}
            tone="danger"
            onPress={() => void revokeCreated()}
            disabled={pending || !canWrite}
          />
        </>
      ) : (
        <>
          <ConnectionFormField
            label={translator.message("mobile.access.clientLabel")}
            value={label}
            onChangeText={setLabel}
            editable={!pending}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("mobile.access.readOnly")}
              onPress={() =>
                setSelected(pairingScopesForSession(session, pairingScopePreset("read")))
              }
              disabled={pending}
            />
            <Button
              label={translator.message("mobile.access.standard")}
              onPress={() =>
                setSelected(pairingScopesForSession(session, pairingScopePreset("standard")))
              }
              disabled={pending}
            />
          </View>
          <SettingsSection title={translator.message("mobile.access.permissions")}>
            {AUTH_SCOPE_OPTIONS.filter(
              ({ scope }) => pairingScopesForSession(session, [scope]).length > 0,
            ).map(({ scope }) => (
              <SettingsSwitchRow
                key={scope}
                icon="lock"
                label={translator.message(accessScopeCopy[scope][0])}
                subtitle={translator.message(accessScopeCopy[scope][1])}
                value={scopes.includes(scope)}
                disabled={pending}
                onValueChange={(enabled) =>
                  setSelected((current) => togglePairingScope(current, scope, enabled))
                }
              />
            ))}
          </SettingsSection>
          {scopes.includes(AuthAccessWriteScope) ? (
            <AppText className="text-foreground-muted">
              {translator.message("mobile.access.manageAccessHint")}
            </AppText>
          ) : null}
          <Button
            label={translator.message("mobile.access.createLink")}
            tone="primary"
            loading={pending}
            disabled={!canWrite || scopes.length === 0 || denial !== undefined}
            onPress={() => void submit()}
          />
          {denial ? <AppText className="text-foreground-muted">{denial}</AppText> : null}
        </>
      )}
      {error ? (
        <AppText accessibilityRole="alert" className="text-danger-foreground">
          {translator.message("mobile.access.mutationFailed")}
        </AppText>
      ) : null}
    </AccessSheet>
  );
}
