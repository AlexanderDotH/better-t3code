import { useAtomValue } from "@effect/atom-react";
import {
  groupHostAccounts,
  directCredentialSettingsPatch,
  hostTokenSettingsPatch,
  nextHostAccountChoices,
  normalizedCredentialHost,
  readHostCredentialSettings,
  sourceControlClients,
  type HostAccountGroup,
  type SourceControlDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import type { ServerSettingsPatch } from "@t3tools/contracts";
import { type ReactNode, useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { ListActionRow } from "../../../components/ui/ListActionRow";
import { ListChoiceRow } from "../../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { sourceControlEnvironment } from "../../../state/sourceControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { ConnectionFormField } from "../../connection/ConnectionFormField";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

export function SourceControlCredentialsSection(props: {
  readonly environment: SettingsTarget;
  readonly disabled: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({
      environmentId: props.environment.environmentId,
      input: {},
    }),
  );
  return (
    <>
      <SettingsSection
        title={`${translator.message("mobile.access.sourceCredentials")} · ${props.environment.label}`}
      >
        <ListActionRow
          icon="arrow.clockwise"
          label={translator.message("mobile.access.rescanAccounts")}
          disabled={discovery.isPending}
          onPress={discovery.refresh}
        />
        {discovery.error ? (
          <AppText className="p-4 text-danger-foreground">
            {translator.message("mobile.access.loadFailed")}
          </AppText>
        ) : null}
      </SettingsSection>
      {sourceControlClients.definitions
        .filter(
          (definition) =>
            definition.credentials ||
            definition.kind === "bitbucket" ||
            definition.kind === "gitcafe" ||
            definition.kind === "gitlab",
        )
        .map((definition) => {
          const item = discovery.data?.sourceControlProviders.find(
            (provider) => provider.kind === definition.kind,
          );
          const groups = groupHostAccounts(item?.auth.accounts ?? []);
          return (
            <CredentialProvider
              key={definition.kind}
              environment={props.environment}
              definition={definition}
              disabled={props.disabled}
              groups={groups}
              refresh={discovery.refresh}
            >
              {definition.kind === "gitlab" && !definition.credentials ? (
                <AppText className="p-4 text-foreground-muted">
                  {translator.message("mobile.access.gitlabHostOnly")}
                </AppText>
              ) : null}
            </CredentialProvider>
          );
        })}
    </>
  );
}

function CredentialProvider(props: {
  readonly environment: SettingsTarget;
  readonly definition: SourceControlDefinition;
  readonly groups: ReadonlyArray<HostAccountGroup>;
  readonly disabled: boolean;
  readonly refresh: () => void;
  readonly children: ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = props.environment.environmentId;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const settings = config?.settings ?? props.environment.serverConfig.settings;
  const credentials = readHostCredentialSettings(settings, props.definition.kind);
  const [host, setHost] = useState(props.definition.publicHost ?? "");
  const [token, setToken] = useState("");
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
    reportDefect: false,
  });
  const disabled = props.disabled || pending;
  const normalizedHost = normalizedCredentialHost(host);
  const saved = settings.sourceControlHosts[props.definition.kind] ?? {};
  const savedHosts = [
    ...new Set([
      ...Object.keys(credentials.hosts),
      ...Object.keys(credentials.tokens),
      ...props.groups.map((group) => group.host),
    ]),
  ];
  async function save(patch: ServerSettingsPatch | null) {
    if (patch === null || disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const result = await update({ environmentId, input: { patch } });
    setError(result._tag !== "Success");
    if (result._tag === "Success") {
      setToken("");
      setFields({});
      props.refresh();
    }
    setPending(false);
    inFlight.current = false;
  }
  const accountPatch = (
    host: string,
    change: { readonly enabled?: boolean; readonly account?: string | null },
  ) => ({
    sourceControlHosts: {
      [props.definition.kind]: { hosts: nextHostAccountChoices(credentials.hosts, host, change) },
    },
  });
  const tokenPatch = (value: string, target = host) =>
    hostTokenSettingsPatch({
      kind: props.definition.kind,
      host: target,
      token: value,
      tokens: credentials.tokens,
    });
  return (
    <SettingsSection title={props.definition.label}>
      {props.children}
      {props.definition.credentials ? (
        <View className="gap-3 p-4">
          <ConnectionFormField
            label={translator.message("mobile.access.host")}
            value={host}
            onChangeText={setHost}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
          <ConnectionFormField
            label={translator.message("mobile.access.personalToken")}
            value={token}
            onChangeText={setToken}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={translator.message(
              normalizedHost && credentials.tokens[normalizedHost]
                ? "mobile.access.configured"
                : "mobile.access.notConfigured",
            )}
            editable={!disabled}
          />
          {!normalizedHost ? (
            <AppText className="text-foreground-muted">
              {translator.message("mobile.access.hostValidation")}
            </AppText>
          ) : null}
          <Button
            label={translator.message("mobile.access.save")}
            disabled={disabled || !normalizedHost || token.trim().length === 0}
            onPress={() => void save(tokenPatch(token))}
          />
        </View>
      ) : null}
      {props.definition.credentials
        ? savedHosts.map((savedHost) => {
            const group = props.groups.find((group) => group.host === savedHost);
            const chosen = credentials.hosts[savedHost];
            return (
              <View key={savedHost}>
                <SettingsSwitchRow
                  icon="globe"
                  label={savedHost}
                  value={chosen?.enabled ?? true}
                  disabled={disabled}
                  onValueChange={(enabled) => void save(accountPatch(savedHost, { enabled }))}
                />
                {credentials.tokens[savedHost] ? (
                  <View className="gap-2 px-4 py-2">
                    <AppText className="text-sm text-foreground-muted">
                      {translator.message("mobile.access.tokenConfigured")}
                    </AppText>
                    <Button
                      label={translator.message("mobile.access.removeToken")}
                      tone="danger"
                      disabled={disabled}
                      onPress={() => void save(tokenPatch("", savedHost))}
                    />
                  </View>
                ) : null}
                {(group?.selectable.length ?? 0) > 0 || chosen?.account !== undefined ? (
                  <>
                    <ListChoiceRow
                      label={translator.message("mobile.access.activeCliAccount")}
                      selected={chosen?.account === undefined}
                      disabled={disabled || chosen?.enabled === false}
                      onPress={() => void save(accountPatch(savedHost, { account: null }))}
                    />
                    {group?.selectable.map((account) => (
                      <ListChoiceRow
                        key={account}
                        label={account}
                        selected={chosen?.account === account}
                        disabled={disabled || chosen?.enabled === false}
                        onPress={() => void save(accountPatch(savedHost, { account }))}
                      />
                    ))}
                    {chosen?.account && !group?.selectable.includes(chosen.account) ? (
                      <AppText className="p-4 text-foreground-muted">
                        {translator.message("mobile.access.staleAccount")}
                      </AppText>
                    ) : null}
                    {group?.environmentVariable ? (
                      <AppText className="p-4 text-foreground-muted">
                        {translator.message("mobile.access.accountOverride", {
                          variable: group.environmentVariable,
                        })}
                      </AppText>
                    ) : null}
                  </>
                ) : null}
              </View>
            );
          })
        : null}
      {props.definition.kind === "bitbucket" || props.definition.kind === "gitcafe" ? (
        <View className="gap-3 p-4">
          {(props.definition.kind === "bitbucket"
            ? ["accessToken", "email", "apiToken"]
            : ["token"]
          ).map((field) => (
            <View key={field} className="gap-1">
              <ConnectionFormField
                label={translator.message(fieldLabels[field]!)}
                value={fields[field] ?? ""}
                onChangeText={(value) => setFields((current) => ({ ...current, [field]: value }))}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                placeholder={translator.message(
                  typeof saved[field] === "string" && saved[field] !== ""
                    ? "mobile.access.configured"
                    : "mobile.access.notConfigured",
                )}
              />
            </View>
          ))}
          <AppText className="text-sm text-foreground-muted">
            {translator.message("mobile.access.keepBlankFields")}
          </AppText>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("mobile.access.save")}
              disabled={
                disabled || directCredentialSettingsPatch(props.definition.kind, fields) === null
              }
              onPress={() =>
                void save(directCredentialSettingsPatch(props.definition.kind, fields))
              }
            />
            <Button
              label={translator.message("mobile.access.remove")}
              tone="danger"
              disabled={
                disabled ||
                !Object.values(saved).some((value) => typeof value === "string" && value !== "")
              }
              onPress={() =>
                void save({
                  sourceControlHosts: {
                    [props.definition.kind]: Object.fromEntries(
                      (props.definition.kind === "bitbucket"
                        ? ["accessToken", "email", "apiToken"]
                        : ["token"]
                      ).map((field) => [field, ""]),
                    ),
                  },
                })
              }
            />
          </View>
        </View>
      ) : null}
      {error ? (
        <AppText accessibilityRole="alert" className="p-4 text-danger-foreground">
          {translator.message("mobile.access.mutationFailed")}
        </AppText>
      ) : null}
    </SettingsSection>
  );
}

const fieldLabels: Readonly<
  Record<
    string,
    | "mobile.access.accessToken"
    | "mobile.access.email"
    | "mobile.access.apiToken"
    | "mobile.access.token"
  >
> = {
  accessToken: "mobile.access.accessToken",
  email: "mobile.access.email",
  apiToken: "mobile.access.apiToken",
  token: "mobile.access.token",
};
