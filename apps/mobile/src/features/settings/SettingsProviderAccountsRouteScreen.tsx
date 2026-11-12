import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import * as Dialog from "../../components/ui/Dialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  type ServerSettingsPatch,
  isManagedDriverAllowed,
  type ProviderAuthResponse,
  type ServerProvider,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { MenuAction } from "@react-native-menu/menu";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { MobileProviderSettings } from "./SettingsAgentEnvironmentsRouteScreen";
import { MobileAgentModelSettings } from "./MobileAgentModelSettings";
import { MobileProviderAdvancedSettings } from "./MobileProviderAdvancedSettings";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";

export function SettingsProviderAccountsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const permittedEnvironments = useEnvironmentsWithScope(selectedTargets, AuthProvidersManageScope);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const insets = useSafeAreaInsets();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen
        title={translator.message("mobile.settings.agents.providers")}
        trailing={<AndroidSettingsEnvironmentFilter />}
      >
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length === 0 ? (
            <Text className="text-foreground-muted">
              {translator.message("mobile.ui.selectAConnectedEnvironment")}
            </Text>
          ) : (
            selectedTargets.map((environment) => (
              <View key={environment.environmentId} className="gap-6">
                <SettingsSection title={environment.label}>
                  {!permittedEnvironments.has(environment.environmentId) ? (
                    <View className="gap-1 p-4">
                      <Text className="text-base text-foreground">
                        {translator.message("settings.providers.panel.limited")}
                      </Text>
                      <Text className="text-sm text-foreground-muted">
                        {`This session can view ${environment.label}'s providers but can't change their settings.`}
                      </Text>
                    </View>
                  ) : (
                    <>
                      {managedProviders(environment, providersByEnvironment)
                        .filter(canManageProvider)
                        .map((provider, index) => (
                          <ProviderAccount
                            key={provider.instanceId}
                            environment={environment}
                            provider={provider}
                            divider={index > 0}
                          />
                        ))}
                      {!managedProviders(environment, providersByEnvironment).some(
                        canManageProvider,
                      ) ? (
                        <Text className="p-4 text-foreground-muted">
                          {translator.message("mobile.ui.configureAProviderWithInAppSign")}
                        </Text>
                      ) : null}
                    </>
                  )}
                </SettingsSection>
                <ProviderEnvironmentSettings
                  environment={environment}
                  canManage={permittedEnvironments.has(environment.environmentId)}
                />
              </View>
            ))
          )}
        </ScreenScrollView>
      </SettingsScreen>
    </>
  );
}

function ProviderEnvironmentSettings(props: {
  readonly environment: SettingsTarget;
  readonly canManage: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects();
  const config = useEnvironmentServerConfig(props.environment.environmentId);
  const write = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: true,
    label: translator.message("mobile.agents.editProvider"),
  });
  const canWrite = useEnvironmentsWithScope([props.environment], AuthSettingsWriteScope).has(
    props.environment.environmentId,
  );
  const updateSettings = async (patch: ServerSettingsPatch) => {
    const result = await write({
      environmentId: props.environment.environmentId,
      input: { patch },
    });
    return result._tag === "Success";
  };
  if (config === null) return null;
  return (
    <>
      <MobileProviderSettings
        environmentId={props.environment.environmentId}
        config={config}
        readOnly={!props.canManage}
        hideAuthentication
      />
      <MobileProviderAdvancedSettings
        config={config}
        disabled={!canWrite}
        updateSettings={updateSettings}
      />
      <SettingsSection title={translator.message("mobile.settings.agents.models")}>
        <MobileAgentModelSettings
          config={config}
          projects={projects.filter(
            (project) => project.environmentId === props.environment.environmentId,
          )}
          disabled={!canWrite}
          updateSettings={updateSettings}
        />
      </SettingsSection>
    </>
  );
}

/** Providers the environment's managed policy allows; the rest cannot run or sign in. */
function managedProviders(
  environment: SettingsTarget,
  providersByEnvironment: ReadonlyMap<string, ReadonlyArray<ServerProvider>>,
) {
  return (providersByEnvironment.get(environment.environmentId) ?? []).filter((provider) =>
    isManagedDriverAllowed(environment.serverConfig.managedPolicy, provider.driver),
  );
}

function canManageProvider(provider: ServerProvider) {
  return Boolean(
    provider.setup?.canAuthenticate || (provider.driver === "acpRegistry" && provider.installed),
  );
}

function ProviderAccount({
  environment,
  provider,
  divider,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
  readonly divider: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = environment.environmentId;
  const instanceId = provider.instanceId;
  const target = { environmentId, input: { instanceId } };
  const auth = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const options = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startProviderAuth, options);
  const respond = useAtomCommand(serverEnvironment.respondProviderAuth, options);
  const complete = useAtomCommand(serverEnvironment.completeProviderAuth, options);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, options);
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, options);
  // Matches ListRowLayout: large text stacks the action below instead of squeezing the status.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", values: {} as Record<string, string> });
  const state = auth.data;
  const interaction = state?.interaction;
  const draftId = `${state?.flowId ?? ""}:${interaction?.id ?? ""}`;
  const values = draft.id === draftId ? draft.values : {};
  const active =
    state?.phase === "starting" || state?.phase === "waiting" || state?.phase === "verifying";
  const signedIn =
    provider.auth.status === "authenticated" ||
    (provider.auth.status === "unknown" && state?.phase === "succeeded");
  const isDiscovering =
    provider.driver === "acpRegistry" &&
    !active &&
    !signedIn &&
    !auth.error &&
    state?.methods === undefined;
  const needsExternalSetup =
    !active &&
    !signedIn &&
    (provider.setup?.canAuthenticate === false ||
      (provider.driver === "acpRegistry" && state?.methods?.length === 0));
  const url =
    interaction?.type === "browser" || interaction?.type === "deviceCode"
      ? interaction.url
      : state?.authorizationUrl;
  const disabled = pending || auth.error !== null || isDiscovering;
  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await command();
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? failure.message
          : translator.message("mobile.ui.couldNotUpdateProviderSignIn"),
      );
    }
    return false;
  }
  function send(response: ProviderAuthResponse) {
    if (!state?.flowId || !interaction) return Promise.resolve(false);
    return run(() =>
      respond({
        environmentId,
        input: { instanceId, flowId: state.flowId!, interactionId: interaction.id, response },
      }),
    );
  }
  function field(name: string, label: string, secret: boolean) {
    return (
      <TextInput
        accessibilityLabel={label}
        className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
        placeholderTextColorClassName="accent-foreground-muted"
        placeholder={label}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        maxLength={secret && interaction?.type === "terminal" ? 4_095 : 16_384}
        value={values[name] ?? ""}
        onChangeText={(value) => setDraft({ id: draftId, values: { ...values, [name]: value } })}
      />
    );
  }
  const name = provider.displayName ?? provider.driver;
  const email = signedIn && !active && provider.enabled ? provider.auth.email?.trim() : undefined;
  const methods = state?.methods ?? [];
  // The status line says why a provider that is missing or turned off can't sign in.
  const canSignIn =
    !active &&
    !needsExternalSetup &&
    provider.setup?.canAuthenticate !== false &&
    provider.enabled &&
    provider.installed;
  const signInDisabled = disabled || state === null;
  const canSignOut =
    !active && signedIn && (provider.auth.canLogout ?? provider.setup?.canAuthenticate);
  const showCallback =
    Boolean(url) && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction);
  const usesCredentials =
    provider.driver === "antigravity" &&
    (provider.auth.type === "gemini-api-key" || provider.auth.type === "agent-platform");
  const status =
    active || state?.phase === "failed" || state?.phase === "cancelled"
      ? state.message
      : !provider.enabled
        ? currentInterfaceTranslator().message("mobile.ui.turnedOff")
        : signedIn
          ? translator.message("mobile.settings.signedIn")
          : isDiscovering
            ? translator.message("mobile.ui.discoveringSignInMethods")
            : needsExternalSetup
              ? translator.message("mobile.ui.noInAppSignInAdvertisedFollowThe")
              : !provider.installed
                ? translator.message("settings.mcp.store.notInstalled")
                : usesCredentials
                  ? translator.message("mobile.ui.connectToLoadModels")
                  : translator.message("mobile.ui.notSignedIn");
  // A provider with several sign-in methods picks one from a menu on the same control.
  const methodActions: MenuAction[] = methods.map((method) => ({
    id: `method:${method.id}`,
    title: method.name,
  }));
  function startSignIn(methodId?: string) {
    void run(() => start(methodId ? { environmentId, input: { instanceId, methodId } } : target));
  }
  function signOut() {
    Dialog.alert(
      translator.message("mobile.ui.signOut2"),
      `Running threads sharing this sign-in on ${environment.label} will stop. Thread history is kept.`,
      [
        { text: translator.message("mobile.settings.projects.settings.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.ui.signOut"),
          style: "destructive",
          onPress: () => {
            void run(() => logout(target));
          },
        },
      ],
    );
  }
  function onMenuAction(id: string) {
    if (id === "signOut") signOut();
    // iOS keeps a disabled submenu's children selectable, so sign-in guards here too.
    else if (signInDisabled) return;
    else if (id.startsWith("method:")) startSignIn(id.slice("method:".length));
    else if (id === "change") startSignIn();
  }
  const accountActions: MenuAction[] = [
    ...(canSignIn
      ? [
          {
            id: "change",
            title: translator.message("mobile.ui.changeAccount"),
            image: "person.crop.circle",
            attributes: { disabled: signInDisabled },
            ...(methodActions.length > 1
              ? {
                  subactions: methodActions.map((action) => ({
                    ...action,
                    attributes: { disabled: signInDisabled },
                  })),
                }
              : {}),
          },
        ]
      : []),
    ...(canSignOut
      ? [
          {
            id: "signOut",
            title: translator.message("mobile.ui.signOut"),
            image: "rectangle.portrait.and.arrow.right",
            attributes: { destructive: true, disabled: disabled || state === null },
          },
        ]
      : []),
  ];
  const trailing = pending ? (
    <View className="h-11 w-11 items-center justify-center">
      <AppActivityIndicator colorClassName="accent-icon" />
    </View>
  ) : needsExternalSetup && provider.setup?.documentationUrl ? (
    <ControlPill
      variant="pill"
      label={translator.message("mobile.ui.docs")}
      onPress={() => {
        void Linking.openURL(provider.setup!.documentationUrl!).catch(() =>
          setError(translator.message("mobile.ui.couldNotOpenTheProviderDocs")),
        );
      }}
    />
  ) : active && state?.flowId ? (
    <ControlPill
      variant="pill"
      label={translator.message("mobile.settings.projects.settings.cancel")}
      accessibilityLabel={`Cancel ${name} sign-in`}
      disabled={disabled}
      onPress={() => {
        void run(() => cancel({ environmentId, input: { instanceId, flowId: state.flowId! } }));
      }}
    />
  ) : signedIn && !active && accountActions.length > 0 ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${name} account options`}
      title={name}
      actions={accountActions}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill icon="ellipsis" accessibilityLabel={`${name} account options`} />
    </Menu>
  ) : canSignIn && !signedIn && methodActions.length > 1 && !signInDisabled ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Sign in to ${name}`}
      title={translator.message("mobile.ui.signInWith")}
      actions={methodActions}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill
        variant="primary"
        label={translator.message("mobile.settings.signIn")}
        accessibilityLabel={`Sign in to ${name}`}
      />
    </Menu>
  ) : canSignIn && !signedIn ? (
    <ControlPill
      variant="primary"
      label={
        usesCredentials
          ? translator.message("mobile.settings.agents.connect")
          : translator.message("mobile.settings.signIn")
      }
      accessibilityLabel={usesCredentials ? `Connect to ${name}` : `Sign in to ${name}`}
      disabled={signInDisabled}
      onPress={() => startSignIn()}
    />
  ) : null;
  return (
    <View className={divider ? "border-t border-border-subtle" : undefined}>
      <View
        className={
          stacked
            ? "min-h-16 items-start gap-3 px-4 py-3"
            : "min-h-16 flex-row items-center gap-3 px-4 py-3"
        }
      >
        <ProviderAccountSummary key={email} name={name} status={status} email={email} />
        {trailing}
      </View>
      {interaction?.type === "deviceCode" ||
      interaction?.type === "terminal" ||
      interaction?.type === "credentials" ||
      showCallback ||
      error ||
      auth.error ? (
        <View className="gap-2 px-4 pb-3">
          {interaction?.type === "deviceCode" ? (
            <Text selectable className="text-foreground">
              Enter code {interaction.userCode} on the sign-in page.
            </Text>
          ) : null}
          {interaction?.type === "terminal" ? (
            <>
              <ScrollView className="max-h-64" nestedScrollEnabled>
                <Text selectable className="font-mono text-sm text-foreground">
                  {interaction.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")}
                </Text>
              </ScrollView>
              {field("input", "Terminal response", true)}
              <SettingsActionRow
                icon="arrow.up"
                label={translator.message("mobile.ui.sendResponse")}
                disabled={disabled}
                onPress={() => {
                  void send({ type: "terminal", data: `${values.input ?? ""}\r` }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {interaction?.type === "credentials" ? (
            <>
              {interaction.fields.map((entry) => (
                <View key={entry.name}>{field(entry.name, entry.label, entry.secret)}</View>
              ))}
              <SettingsActionRow
                icon="person.crop.circle"
                label={translator.message("mobile.settings.agents.connect")}
                disabled={disabled}
                onPress={() => {
                  void send({ type: "credentials", values }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {showCallback ? (
            <>
              {field("callback", "Final localhost URL", false)}
              <SettingsActionRow
                icon="arrow.right"
                label={translator.message("mobile.settings.connect.continue")}
                disabled={disabled || !values.callback?.trim()}
                onPress={() => {
                  if (!state?.flowId) return;
                  void run(() =>
                    complete({
                      environmentId,
                      input: { instanceId, flowId: state.flowId!, callbackUrl: values.callback! },
                    }),
                  ).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {error || auth.error ? (
            <Text accessibilityRole="alert" className="text-danger-foreground">
              {error ?? auth.error}
            </Text>
          ) : null}
        </View>
      ) : null}
      {url ? (
        <SettingsActionRow
          icon="globe"
          label={translator.message("mobile.ui.openSignInPage")}
          disabled={disabled}
          onPress={() => {
            void (async () => {
              if (
                interaction?.type === "browser" &&
                interaction.requiresConsent &&
                !(await send({ type: "browser", action: "accept" }))
              )
                return;
              await Linking.openURL(url);
            })().catch(() => setError(translator.message("mobile.ui.couldNotOpenTheSignInPage")));
          }}
        />
      ) : null}
    </View>
  );
}

function ProviderAccountSummary({
  name,
  status,
  email,
}: {
  readonly name: string;
  readonly status: string | null | undefined;
  readonly email: string | undefined;
}) {
  const translator = useMobileInterfaceTranslator();
  const [revealed, setRevealed] = useState(false);
  const content = (
    <>
      <Text textRole="body" className="text-foreground" numberOfLines={1}>
        {name}
      </Text>
      <Text accessibilityLiveRegion="polite" textRole="footnote" className="text-foreground-muted">
        {email ? `${status} · ${revealed ? email : "••••••@••••••"}` : status}
      </Text>
    </>
  );
  if (!email) {
    return (
      <View
        accessible
        accessibilityLabel={[name, status].filter(Boolean).join(", ")}
        className="min-w-0 shrink grow gap-0.5"
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, status, revealed ? email : null].filter(Boolean).join(", ")}
      accessibilityHint={
        revealed
          ? translator.message("mobile.ui.hidesTheAccountEmail")
          : translator.message("mobile.ui.revealsTheAccountEmail")
      }
      onPress={() => setRevealed((value) => !value)}
      className="min-w-0 shrink grow gap-0.5"
    >
      {content}
    </Pressable>
  );
}
