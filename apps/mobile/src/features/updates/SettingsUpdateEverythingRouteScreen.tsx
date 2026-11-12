import { useAtomValue } from "@effect/atom-react";
import {
  AuthEnvironmentMaintainScope,
  AuthProvidersManageScope,
  managedUpdatesDenial,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { appAtomRegistry as registry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  canUpdateEnvironmentProvider,
  findEnvironmentUpdate,
  supportsEnvironmentUpdate,
} from "../settings/environment-maintenance";
import { InsightValue } from "../diagnostics/InsightsSheet";
import {
  isAppUpdateCheckAvailable,
  runAppUpdateCheck,
  type AppUpdateCheckState,
} from "./app-updates";

type UpdateStatus =
  | "checking"
  | "ready"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "current"
  | "skipped";
type ProviderUpdate = {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly status: UpdateStatus;
  readonly error?: string;
};
type MachineUpdate = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly targetVersion: string | null;
  readonly status: UpdateStatus;
  readonly error?: string;
  readonly providers: readonly ProviderUpdate[];
};
type UpdateRun = {
  readonly phase: "idle" | "checking" | "ready" | "running" | "finished";
  readonly machines: readonly MachineUpdate[];
  readonly appUpdateStatus: AppUpdateCheckState;
  readonly clientError: string | null;
};
const updateRunAtom = Atom.make<UpdateRun>({
  phase: "idle" as const,
  machines: [],
  appUpdateStatus: "idle",
  clientError: null,
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:updates:everything"));
let operationPending = false;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const updateMachine = (
  environmentId: EnvironmentId,
  update: (machine: MachineUpdate) => MachineUpdate,
) =>
  registry.update(updateRunAtom, (run) => ({
    ...run,
    machines: run.machines.map((machine) =>
      machine.environmentId === environmentId ? update(machine) : machine,
    ),
  }));
const updateProvider = (
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
  status: UpdateStatus,
  error?: string,
) =>
  updateMachine(environmentId, (machine) => ({
    ...machine,
    providers: machine.providers.map((provider) =>
      provider.instanceId === instanceId
        ? { ...provider, status, ...(error ? { error } : {}) }
        : provider,
    ),
  }));

function providerCandidates(providers: readonly ServerProvider[]) {
  const grouped = new Map<ServerProvider["driver"], ServerProvider[]>();
  for (const provider of providers)
    if (canUpdateEnvironmentProvider(provider))
      grouped.set(provider.driver, [...(grouped.get(provider.driver) ?? []), provider]);
  return [...grouped.values()].flatMap((group) =>
    new Set(group.map((provider) => provider.versionAdvisory?.updateCommand)).size === 1
      ? [group[0]!]
      : [],
  );
}

async function checkUpdates() {
  if (operationPending) return;
  operationPending = true;
  const environments = registry.get(environmentPresentations.presentationsAtom);
  registry.set(updateRunAtom, {
    phase: "checking" as const,
    machines: [...environments].map(([environmentId, environment]) => ({
      environmentId,
      label: environment.entry.target.label,
      targetVersion: null,
      status: "checking" as const,
      providers: [],
    })),
    appUpdateStatus: "idle",
    clientError: null,
  });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30_000);
  try {
    await Promise.all(
      [...environments].map(async ([environmentId, environment]) => {
        const config = registry.get(serverEnvironment.configValueAtom(environmentId));
        if (environment.connection.phase !== "connected" || !config) {
          updateMachine(environmentId, (machine) => ({
            ...machine,
            status: "skipped",
            error: currentInterfaceTranslator().message("mobile.insights.updates.offline"),
          }));
          return;
        }
        if (readEnvironmentScope(environmentId, AuthProvidersManageScope)) {
          await runAtomCommand(
            registry,
            serverEnvironment.refreshProviders,
            { environmentId, input: {} },
            { reportFailure: false },
          );
          const providers = registry.get(serverEnvironment.providersValueAtom(environmentId));
          updateMachine(environmentId, (machine) => ({
            ...machine,
            providers: providerCandidates(providers ?? []).map((provider) => ({
              instanceId: provider.instanceId,
              driver: provider.driver,
              label: provider.displayName ?? provider.driver,
              status: "ready",
            })),
          }));
        }
        if (
          !readEnvironmentScope(environmentId, AuthEnvironmentMaintainScope) ||
          !supportsEnvironmentUpdate(config.environment.capabilities) ||
          managedUpdatesDenial(config.managedPolicy)
        ) {
          updateMachine(environmentId, (machine) => ({
            ...machine,
            status: "skipped",
            error:
              managedUpdatesDenial(config.managedPolicy) ??
              currentInterfaceTranslator().message("mobile.insights.updates.noPermission"),
          }));
          return;
        }
        try {
          const targetVersion = await findEnvironmentUpdate(
            config.environment.serverVersion,
            abort.signal,
          );
          updateMachine(environmentId, (machine) => ({
            ...machine,
            targetVersion,
            status: targetVersion ? "ready" : "current",
          }));
        } catch (error) {
          updateMachine(environmentId, (machine) => ({
            ...machine,
            status: "failed",
            error: errorMessage(error),
          }));
        }
      }),
    );
    registry.update(updateRunAtom, (run) => ({ ...run, phase: "ready" as const }));
  } finally {
    clearTimeout(timeout);
    operationPending = false;
  }
}

async function runUpdates() {
  if (operationPending) return;
  operationPending = true;
  const plan = registry.get(updateRunAtom).machines;
  registry.update(updateRunAtom, (run) => ({ ...run, phase: "running" as const }));
  try {
    await Promise.all(
      plan.flatMap((machine) =>
        machine.providers.map(async (provider) => {
          updateProvider(machine.environmentId, provider.instanceId, "running");
          try {
            const result = await runAtomCommand(
              registry,
              serverEnvironment.updateProvider,
              {
                environmentId: machine.environmentId,
                input: { provider: provider.driver, instanceId: provider.instanceId },
              },
              { reportFailure: false },
            );
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            const state = result.value.providers.find(
              (entry) => entry.instanceId === provider.instanceId,
            )?.updateState;
            if (state?.status !== "succeeded")
              throw new Error(
                state?.status === "failed"
                  ? (state.message ??
                      currentInterfaceTranslator().message("mobile.insights.updates.failed"))
                  : currentInterfaceTranslator().message("mobile.insights.updates.failed"),
              );
            updateProvider(machine.environmentId, provider.instanceId, "succeeded");
          } catch (error) {
            updateProvider(
              machine.environmentId,
              provider.instanceId,
              "failed",
              errorMessage(error),
            );
          }
        }),
      ),
    );
    await Promise.all(
      plan
        .filter((machine) => machine.targetVersion !== null)
        .map(async (machine) => {
          updateMachine(machine.environmentId, (current) => ({ ...current, status: "running" }));
          try {
            if (!readEnvironmentScope(machine.environmentId, AuthEnvironmentMaintainScope))
              throw new Error(
                currentInterfaceTranslator().message("mobile.insights.updates.noPermission"),
              );
            const result = await runAtomCommand(
              registry,
              serverEnvironment.updateServer,
              {
                environmentId: machine.environmentId,
                input: { targetVersion: machine.targetVersion! },
              },
              { reportFailure: false },
            );
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            updateMachine(machine.environmentId, (current) => ({
              ...current,
              status: "succeeded",
            }));
          } catch (error) {
            updateMachine(machine.environmentId, (current) => ({
              ...current,
              status: "failed",
              error: errorMessage(error),
            }));
          }
        }),
    );
    if (isAppUpdateCheckAvailable())
      await runAppUpdateCheck({
        applyMode: "immediate",
        onStateChange: (appUpdateStatus) =>
          registry.update(updateRunAtom, (run) => ({ ...run, appUpdateStatus })),
        onFailure: (clientError) =>
          registry.update(updateRunAtom, (run) => ({ ...run, clientError })),
      });
    registry.update(updateRunAtom, (run) => ({ ...run, phase: "finished" as const }));
  } finally {
    operationPending = false;
  }
}

export function SettingsUpdateEverythingRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const run = useAtomValue(updateRunAtom);
  const busy = run.phase === "running" || run.phase === "checking";
  const requestRun = () =>
    Dialog.alert(
      translator.message("mobile.insights.updates.confirm"),
      translator.message("mobile.insights.updates.description"),
      [
        { text: translator.message("settings.common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.insights.updates.title"),
          onPress: () => {
            void runUpdates().catch((error: unknown) => {
              registry.update(updateRunAtom, (current) => ({
                ...current,
                phase: "finished" as const,
                clientError: errorMessage(error),
              }));
            });
          },
        },
      ],
    );
  return (
    <SettingsScreen title={translator.message("mobile.insights.updates.title")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <Text className="text-sm text-foreground-muted">
          {translator.message("mobile.insights.updates.description")}
        </Text>
        <Button
          label={translator.message("mobile.insights.updates.check")}
          disabled={busy}
          loading={run.phase === "checking"}
          onPress={() => {
            void checkUpdates().catch((error: unknown) =>
              registry.update(updateRunAtom, (current) => ({
                ...current,
                phase: "finished" as const,
                clientError: errorMessage(error),
              })),
            );
          }}
        />
        {run.phase === "ready" ? (
          <Button
            label={translator.message("mobile.insights.updates.title")}
            onPress={requestRun}
          />
        ) : null}
        {run.machines.map((machine) => (
          <SettingsSection key={machine.environmentId} title={machine.label}>
            <MachineUpdateProgress machine={machine} />
            <View className="px-4">
              {machine.providers.map((provider) => (
                <View key={provider.instanceId}>
                  <InsightValue
                    label={provider.label}
                    value={translator.message(`mobile.insights.updates.${provider.status}`)}
                  />
                  {provider.error ? (
                    <Text selectable className="text-xs text-danger-foreground">
                      {provider.error}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </SettingsSection>
        ))}
        <SettingsSection title={translator.message("mobile.insights.updates.client")}>
          <View className="gap-2 p-4">
            <Text className="text-sm text-foreground-muted">
              {isAppUpdateCheckAvailable()
                ? translator.message(`mobile.insights.updates.client.${run.appUpdateStatus}`)
                : translator.message("mobile.insights.updates.store")}
            </Text>
            {run.clientError ? (
              <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
                {run.clientError}
              </Text>
            ) : null}
          </View>
        </SettingsSection>
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function MachineUpdateProgress(props: { readonly machine: MachineUpdate }) {
  const translator = useMobileInterfaceTranslator();
  const live = useAtomValue(serverEnvironment.updateStateAtom(props.machine.environmentId));
  const message =
    props.machine.status === "running" && live.status === "running"
      ? translator.message(
          `serverUpdate.stage.${live.stage === "resuming" ? "restarting" : "downloading"}`,
        )
      : translator.message(`mobile.insights.updates.${props.machine.status}`);
  return (
    <View className="p-4">
      <InsightValue
        label={props.machine.targetVersion ? `T3 Code ${props.machine.targetVersion}` : "T3 Code"}
        value={message}
      />
      {props.machine.error ? (
        <Text selectable className="text-xs text-foreground-muted">
          {props.machine.error}
        </Text>
      ) : null}
    </View>
  );
}
