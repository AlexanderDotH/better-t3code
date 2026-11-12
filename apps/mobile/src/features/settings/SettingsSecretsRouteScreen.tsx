import { useAtomValue } from "@effect/atom-react";
import { AuthProvidersManageScope, SecretProviderId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { AccessSheet } from "../connection/AccessSheet";
import { ConnectionFormField } from "../connection/ConnectionFormField";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { isMobileSecretsFeatureEnabled, secretProviderPatch } from "./secret-provider-settings";

export function SettingsSecretsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const { selectedTargets, selectedProjectKey } = useSettingsEnvironmentFilter();
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen
        title={translator.message("mobile.access.secrets")}
        trailing={<AndroidSettingsEnvironmentFilter />}
      >
        <ScreenScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        >
          {isMobileSecretsFeatureEnabled
            ? selectedTargets.map((environment) => (
                <SecretProviders
                  key={environment.environmentId}
                  environment={environment}
                  projectScoped={selectedProjectKey !== null}
                />
              ))
            : null}
          {isMobileSecretsFeatureEnabled && selectedTargets.length === 0 ? (
            <AppText className="text-foreground-muted">
              {translator.message("mobile.ui.selectAConnectedEnvironment")}
            </AppText>
          ) : null}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function SecretProviders(props: {
  readonly environment: SettingsTarget;
  readonly projectScoped: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = props.environment.environmentId;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const [editing, setEditing] = useState<SecretProviderId | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const providers = config?.settings.secretProviders ?? {};
  const supported = config?.secretProviderSettings === true;
  const disabled = !supported || !canManage || props.projectScoped || pending;
  const remove = (id: SecretProviderId) =>
    Alert.alert(
      providers[id]?.label ?? id,
      translator.message("mobile.access.removeProviderHint"),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.access.remove"),
          style: "destructive",
          onPress: () => {
            if (disabled) return;
            setPending(true);
            void update({
              environmentId,
              input: { patch: { secretProviders: { [id]: null } } },
            }).then((result) => {
              setError(result._tag !== "Success");
              setPending(false);
            });
          },
        },
      ],
    );
  return (
    <SettingsSection
      title={`${translator.message("mobile.access.secretProviders")} · ${props.environment.label}`}
      footer={
        !supported
          ? translator.message("mobile.access.secretUnsupported")
          : props.projectScoped
            ? translator.message("mobile.access.environmentWide")
            : undefined
      }
    >
      <ListActionRow
        icon="plus"
        label={translator.message("mobile.access.addProvider")}
        disabled={disabled}
        onPress={() => setEditing("new")}
      />
      {Object.entries(providers).map(([id, provider]) => (
        <View key={id} className="gap-2 p-4">
          <AppText className="font-t3-medium text-foreground">{provider.label}</AppText>
          <AppText className="text-sm text-foreground-muted">
            {provider.kind === "one_password" ? "1Password" : provider.kind} ·{" "}
            {translator.message("mobile.access.configured")}
          </AppText>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("common.edit")}
              disabled={disabled || provider.kind !== "one_password"}
              onPress={() => setEditing(SecretProviderId.make(id))}
            />
            <Button
              label={translator.message("mobile.access.remove")}
              tone="danger"
              disabled={disabled}
              onPress={() => remove(SecretProviderId.make(id))}
            />
          </View>
        </View>
      ))}
      {Object.keys(providers).length === 0 ? (
        <AppText className="p-4 text-foreground-muted">
          {translator.message("mobile.access.secretEmpty")}
        </AppText>
      ) : null}
      {error ? (
        <AppText className="p-4 text-danger-foreground">
          {translator.message("mobile.access.mutationFailed")}
        </AppText>
      ) : null}
      {editing !== null && !disabled ? (
        <SecretProviderEditor
          environment={props.environment}
          {...(editing === "new" ? {} : { editingId: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SettingsSection>
  );
}

function SecretProviderEditor(props: {
  readonly environment: SettingsTarget;
  readonly editingId?: SecretProviderId;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = props.environment.environmentId;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const providers = config?.settings.secretProviders ?? {};
  const existing = props.editingId ? providers[props.editingId] : undefined;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [account, setAccount] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const patch = secretProviderPatch({
    label,
    account,
    providers,
    ...(props.editingId ? { editingId: props.editingId } : {}),
  });
  async function save() {
    if (inFlight.current || !patch || !canManage) return;
    inFlight.current = true;
    setPending(true);
    const result = await update({ environmentId, input: { patch } });
    if (result._tag === "Success") props.onClose();
    else setError(true);
    setPending(false);
    inFlight.current = false;
  }
  return (
    <AccessSheet
      title={translator.message(
        existing ? "mobile.access.editProvider" : "mobile.access.addProvider",
      )}
      busy={pending}
      onClose={props.onClose}
    >
      <AppText className="text-foreground">
        {translator.message("mobile.access.providerKind")}: 1Password
      </AppText>
      <ConnectionFormField
        label={translator.message("mobile.access.providerLabel")}
        value={label}
        onChangeText={setLabel}
        maxLength={64}
        editable={!pending}
      />
      <ConnectionFormField
        label={translator.message("mobile.access.onePasswordAccount")}
        value={account}
        onChangeText={setAccount}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={253}
        placeholder={existing ? translator.message("mobile.access.configured") : undefined}
        editable={!pending}
      />
      {!patch ? (
        <AppText className="text-foreground-muted">
          {translator.message("mobile.access.secretValidation")}
        </AppText>
      ) : null}
      {error ? (
        <AppText accessibilityRole="alert" className="text-danger-foreground">
          {translator.message("mobile.access.mutationFailed")}
        </AppText>
      ) : null}
      <Button
        label={translator.message("mobile.access.save")}
        tone="primary"
        loading={pending}
        disabled={!patch || !canManage}
        onPress={() => void save()}
      />
    </AccessSheet>
  );
}
