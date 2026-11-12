import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAtomValue } from "@effect/atom-react";
import {
  DeviceHostId,
  AuthSettingsWriteScope,
  isManagedSettingPath,
  type DeviceHostConfig,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { uuidv4 } from "../../lib/uuid";
import { ProjectSettingsField } from "./ProjectSettingsFields";
import {
  deviceHostDraft,
  parseDeviceHostSettings,
  type DeviceHostDraft,
} from "./device-host-settings";

export function SettingsDevicesRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen
        title={translator.message("mobile.projects.devices.title")}
        trailing={<AndroidSettingsEnvironmentFilter />}
      >
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {selectedTargets.length === 0 ? (
            <AppText className="px-2 text-foreground-muted">
              {translator.message("mobile.ui.useTheFilterAboveToSelectA")}
            </AppText>
          ) : null}
          {selectedTargets.map((target) => (
            <DeviceServiceSettings key={target.environmentId} target={target} />
          ))}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function DeviceServiceSettings(props: { readonly target: SettingsTarget }) {
  const translator = useMobileInterfaceTranslator();
  const { environmentId, label, serverConfig } = props.target;
  const allowed = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "device service settings",
    reportFailure: true,
  });
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<DeviceHostConfig | null>(null);
  const settings = serverConfig.settings;
  const disabledFor = (key: string) =>
    pending ||
    !allowed ||
    !canWriteSettings ||
    isManagedSettingPath(serverConfig.managedPolicy, key);
  const write = async (patch: ServerSettingsPatch) => {
    if (pending || !readEnvironmentScope(environmentId, AuthSettingsWriteScope)) return false;
    setPending(true);
    return await (async () => {
      return (await update({ environmentId, input: { patch } }))._tag === "Success";
    })().finally(() => {
      setPending(false);
    });
  };
  const hostKey = (kind: DeviceHostConfig["kind"]) =>
    kind === "ssh"
      ? ("deviceHosts" as const)
      : kind === "eas"
        ? ("easDeviceHosts" as const)
        : ("simlockDeviceHosts" as const);
  const saveHost = async (host: DeviceHostConfig) => {
    const key = hostKey(host.kind);
    const hosts = settings[key].map((entry) => (entry.id === host.id ? host : entry));
    if (
      await write({
        [key]: settings[key].some((entry) => entry.id === host.id) ? hosts : [...hosts, host],
      })
    )
      setEditor(null);
  };
  const add = (kind: DeviceHostConfig["kind"]) => {
    const id = DeviceHostId.make(`host-${uuidv4()}`);
    setEditor(
      kind === "ssh"
        ? { kind, id, label: "", target: "" }
        : kind === "eas"
          ? {
              kind,
              id,
              label: "",
              accessToken: "",
              maxConcurrentSessions: 2,
              maxSessionMinutes: 30,
              idleMinutes: 10,
            }
          : {
              kind,
              id,
              label: "",
              gatewayUrl: "",
              agentToken: "",
              maxLeases: 2,
              maxLeaseMinutes: 60,
            },
    );
  };
  return (
    <View className="gap-4">
      <SettingsSection title={label}>
        {(["enableDeviceSupport", "enableAgentDeviceAccess"] as const).map((key) => (
          <SettingsSwitchRow
            key={key}
            icon="iphone"
            label={translator.message(`mobile.projects.devices.${key}`)}
            value={settings[key]}
            disabled={disabledFor(key)}
            onValueChange={(value) => void write({ [key]: value })}
          />
        ))}
        <AppText className="px-4 pb-3 text-sm text-foreground-muted">
          {translator.message("mobile.projects.devices.serverHosts")}
        </AppText>
      </SettingsSection>
      {(["ssh", "eas", "simlock"] as const)
        .filter((kind) => kind !== "simlock" || settings.simlockDeviceHostsEnabled)
        .map((kind) => (
          <SettingsSection key={kind} title={translator.message(`mobile.projects.devices.${kind}`)}>
            {settings[hostKey(kind)].map((host) => (
              <SettingsRow
                key={host.id}
                icon="server.rack"
                label={host.label}
                value={
                  host.kind === "ssh"
                    ? host.target
                    : host.kind === "eas"
                      ? host.appId
                      : host.gatewayUrl
                }
                disabled={disabledFor(hostKey(kind))}
                onPress={() => setEditor(host)}
              />
            ))}
            <View className="p-4">
              <Button
                label={translator.message("mobile.projects.devices.addHost")}
                disabled={disabledFor(hostKey(kind))}
                onPress={() => add(kind)}
              />
            </View>
          </SettingsSection>
        ))}
      {editor ? (
        <DeviceHostSettingsEditor
          key={editor.id}
          host={editor}
          disabled={disabledFor(hostKey(editor.kind))}
          onSave={(host) => void saveHost(host)}
          onClose={() => setEditor(null)}
          onDelete={
            settings[hostKey(editor.kind)].some((host) => host.id === editor.id)
              ? () => {
                  const key = hostKey(editor.kind);
                  void write({ [key]: settings[key].filter((host) => host.id !== editor.id) }).then(
                    (saved) => {
                      if (saved) setEditor(null);
                    },
                  );
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

function DeviceHostSettingsEditor(props: {
  readonly host: DeviceHostConfig;
  readonly disabled: boolean;
  readonly onSave: (host: DeviceHostConfig) => void;
  readonly onClose: () => void;
  readonly onDelete?: (() => void) | undefined;
}) {
  const translator = useMobileInterfaceTranslator();
  const [draft, setDraft] = useState(() => deviceHostDraft(props.host));
  const [credentialChanged, setCredentialChanged] = useState(false);
  const parsed = parseDeviceHostSettings(props.host, draft, credentialChanged);
  const keys: readonly (keyof DeviceHostDraft)[] =
    props.host.kind === "ssh"
      ? ["label", "target", "identityFile", "port"]
      : props.host.kind === "eas"
        ? [
            "label",
            "credential",
            "appId",
            "maxConcurrentSessions",
            "maxSessionMinutes",
            "idleMinutes",
          ]
        : ["label", "gatewayUrl", "credential", "maxLeases", "maxLeaseMinutes"];
  const hasSavedCredential =
    props.host.kind === "eas"
      ? props.host.accessToken !== ""
      : props.host.kind === "simlock" && props.host.agentToken !== "";
  return (
    <SettingsSection title={translator.message("mobile.projects.devices.editHost")}>
      {keys.map((key) => (
        <ProjectSettingsField
          key={key}
          label={translator.message(
            key === "credential"
              ? props.host.kind === "eas"
                ? "mobile.projects.devices.accessToken"
                : "mobile.projects.devices.agentToken"
              : `mobile.projects.devices.${key}`,
          )}
          value={draft[key]}
          disabled={props.disabled}
          secret={key === "credential"}
          numeric={[
            "port",
            "maxConcurrentSessions",
            "maxSessionMinutes",
            "idleMinutes",
            "maxLeases",
            "maxLeaseMinutes",
          ].includes(key)}
          placeholder={
            key === "credential" && hasSavedCredential && !credentialChanged
              ? translator.message("mobile.projects.secretSaved")
              : undefined
          }
          onChange={(value) => {
            if (key === "credential") setCredentialChanged(true);
            setDraft((current) => ({ ...current, [key]: value }));
          }}
        />
      ))}
      {props.host.kind !== "ssh" ? (
        <View className="px-4">
          <Button
            label={translator.message("mobile.projects.clearSecret")}
            disabled={props.disabled}
            tone="text"
            onPress={() => {
              setCredentialChanged(true);
              setDraft((current) => ({ ...current, credential: "" }));
            }}
          />
        </View>
      ) : null}
      <View className="gap-3 p-4">
        {parsed === null ? (
          <AppText className="text-sm text-danger">
            {translator.message(
              props.host.kind === "eas"
                ? "mobile.projects.devices.invalidEas"
                : "mobile.projects.devices.invalid",
            )}
          </AppText>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={translator.message("mobile.projects.save")}
            disabled={props.disabled || parsed === null}
            tone="primary"
            onPress={() => {
              if (parsed) props.onSave(parsed);
            }}
          />
          <Button
            label={translator.message("common.cancel")}
            disabled={props.disabled}
            tone="text"
            onPress={props.onClose}
          />
          {props.onDelete ? (
            <Button
              label={translator.message("mobile.projects.delete")}
              disabled={props.disabled}
              tone="danger"
              onPress={props.onDelete}
            />
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}
