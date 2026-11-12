import type { EnvironmentId, SourceControlSignInPrompt } from "@t3tools/contracts";
import {
  readHostCredentialSettings,
  sourceControlClients,
  type SourceControlAppSignIn,
  type SourceControlDefinition,
} from "@t3tools/client-runtime/source-control-clients";
import * as Cause from "effect/Cause";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Alert, Linking } from "react-native";

import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { sourceControlEnvironment } from "../../../state/sourceControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { SourceControlCredentialsSection } from "./SourceControlCredentialsSection";

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

const openUrl = (url: string) => void Linking.openURL(url).catch(() => undefined);

const appSignInHosts = sourceControlClients.definitions.flatMap((definition) =>
  definition.credentials?.appSignIn === undefined
    ? []
    : [{ definition, appSignIn: definition.credentials.appSignIn }],
);

/**
 * Signing an environment in through a forge's own app, such as T3 Code for GitHub, on servers
 * configured for it.
 */
export function SourceControlSignInSection(props: {
  readonly environments: readonly SettingsTarget[];
  readonly canWrite: (environmentId: EnvironmentId) => boolean;
}) {
  return (
    <>
      {appSignInHosts.flatMap(({ definition, appSignIn }) =>
        props.environments.map((environment) => (
          <OfferedAppSignIn
            key={`${definition.kind}:${environment.environmentId}`}
            environment={environment}
            title={
              props.environments.length > 1
                ? `${definition.label} · ${environment.label}`
                : definition.label
            }
            definition={definition}
            appSignIn={appSignIn}
            disabled={!props.canWrite(environment.environmentId)}
          />
        )),
      )}
      {props.environments.map((environment) => (
        <SourceControlCredentialsSection
          key={environment.environmentId}
          environment={environment}
          disabled={!props.canWrite(environment.environmentId)}
        />
      ))}
    </>
  );
}

function OfferedAppSignIn(props: {
  readonly environment: SettingsTarget;
  readonly title: string;
  readonly definition: SourceControlDefinition;
  readonly appSignIn: SourceControlAppSignIn;
  readonly disabled: boolean;
}) {
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({
      environmentId: props.environment.environmentId,
      input: {},
    }),
  );
  const offered = discovery.data?.sourceControlProviders.some(
    (item) => item.kind === props.definition.kind && item.appSignIn === true,
  );
  if (offered !== true) return null;
  return (
    <SettingsSection title={props.title}>
      {props.appSignIn.hosts.map((host) => (
        <AppSignInRow
          key={host}
          host={host}
          environment={props.environment}
          label={`${props.appSignIn.appName} · ${host}`}
          definition={props.definition}
          appSignIn={props.appSignIn}
          disabled={props.disabled}
        />
      ))}
    </SettingsSection>
  );
}

function AppSignInRow(props: {
  readonly host: string;
  readonly environment: SettingsTarget;
  readonly label: string;
  readonly definition: SourceControlDefinition;
  readonly appSignIn: SourceControlAppSignIn;
  readonly disabled: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const { environment, definition, appSignIn } = props;
  const environmentId = environment.environmentId;
  const host = props.host;
  const { signIns } = readHostCredentialSettings(
    environment.serverConfig.settings,
    definition.kind,
  );
  const signedIn = (signIns[host] ?? "").length > 0;
  const start = useAtomCommand(sourceControlEnvironment.startSignIn, {
    reportFailure: false,
    reportDefect: false,
  });
  const wait = useAtomCommand(sourceControlEnvironment.waitForSignIn, {
    reportFailure: false,
    reportDefect: false,
  });
  const cancel = useAtomCommand(sourceControlEnvironment.cancelSignIn, {
    reportFailure: false,
    reportDefect: false,
  });
  // The attempt a pending `wait` belongs to; a cancel or a newer attempt makes its outcome stale.
  const attempt = useRef<SourceControlSignInPrompt | null>(null);
  const input = { provider: definition.kind, host };
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `sign out of ${appSignIn.appName}`,
    reportFailure: false,
    reportDefect: false,
  });
  const [pending, setPending] = useState<SourceControlSignInPrompt | "starting" | null>(null);

  const showCode = (prompt: SourceControlSignInPrompt) => {
    void Clipboard.setStringAsync(prompt.userCode).catch(() => undefined);
    Alert.alert(
      prompt.userCode,
      translator.message("mobile.access.signInCodeHint", { host, app: appSignIn.appName }),
      [
        {
          text: translator.message("mobile.settings.projects.settings.cancel"),
          style: "cancel",
          onPress: () => {
            attempt.current = null;
            setPending(null);
            void cancel({ environmentId, input });
          },
        },
        {
          text: translator.message("mobile.access.openHost", { host }),
          onPress: () => openUrl(prompt.verificationUri),
        },
      ],
    );
  };

  const signIn = async () => {
    setPending("starting");
    const started = await start({ environmentId, input });
    if (started._tag !== "Success") {
      setPending(null);
      Alert.alert(
        translator.message("mobile.ui.couldNotStartTheSignIn"),
        failureMessage(started.cause),
      );
      return;
    }
    const prompt = started.value;
    attempt.current = prompt;
    setPending(prompt);
    showCode(prompt);
    const finished = await wait({ environmentId, input });
    if (attempt.current !== prompt) return;
    attempt.current = null;
    setPending(null);
    if (finished._tag !== "Success") {
      Alert.alert(
        translator.message("mobile.ui.signInDidNotFinish"),
        failureMessage(finished.cause),
      );
    }
  };

  const signOut = () =>
    void updateSettings({
      environmentId,
      // Send the whole map; other hosts' redaction markers preserve their sessions.
      input: {
        patch: {
          sourceControlHosts: { [definition.kind]: { signIns: { ...signIns, [host]: "" } } },
        },
      },
    });

  const onPress = () => {
    if (signedIn) {
      Alert.alert(
        appSignIn.appName,
        translator.message("mobile.access.signedInApp", { app: appSignIn.appName }),
        [
          {
            text: translator.message("mobile.ui.installOnAnOrganization"),
            onPress: () => openUrl(appSignIn.installUrl),
          },
          { text: translator.message("mobile.ui.signOut"), style: "destructive", onPress: signOut },
          { text: translator.message("mobile.settings.projects.settings.cancel"), style: "cancel" },
        ],
      );
    } else if (pending !== null && pending !== "starting") {
      showCode(pending);
    } else if (pending === null) {
      void signIn();
    }
  };

  return (
    <SettingsRow
      icon="person.crop.circle"
      label={props.label}
      value={
        signedIn
          ? translator.message("mobile.access.signedIn")
          : pending === "starting"
            ? translator.message("mobile.access.starting")
            : pending !== null
              ? translator.message("mobile.access.enterCode", { code: pending.userCode })
              : translator.message("mobile.settings.signIn")
      }
      disabled={props.disabled}
      onPress={onPress}
    />
  );
}
