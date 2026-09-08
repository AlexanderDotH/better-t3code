import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  applyShowcaseLocalEnvironmentDisplayUrls,
  resolveShowcaseEnvironmentUpdateDisplayUrl,
  SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
  SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS,
} from "../showcase/showcaseEnvironmentRows";
import { CloudEnvironmentRows } from "./CloudEnvironmentRows";
import { ConnectionEnvironmentRow } from "./ConnectionEnvironmentRow";
import { environmentPairingPrefill, splitEnvironmentSections } from "./environmentSections";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

export function EnvironmentManagerContent(props: {
  readonly onPairAgain: (environmentId: EnvironmentId) => void;
  readonly onSignIn: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const {
    connectedEnvironments,
    onChangeConnectionPairingUrl,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<EnvironmentId | null>(null);
  const { sections, localEnvironments, savedEnvironments } = useMemo(() => {
    const nextSections = splitEnvironmentSections({
      connectedEnvironments,
      cloudEnvironments: null,
    });
    const nextLocalEnvironments = SHOWCASE_ENABLED
      ? applyShowcaseLocalEnvironmentDisplayUrls(nextSections.localEnvironments)
      : nextSections.localEnvironments;
    const nextConnectedCloudEnvironments = SHOWCASE_ENABLED
      ? SHOWCASE_CONNECTED_CLOUD_ENVIRONMENTS
      : nextSections.connectedCloudEnvironments;
    return {
      sections: nextSections,
      localEnvironments: nextLocalEnvironments,
      savedEnvironments: [...nextLocalEnvironments, ...nextConnectedCloudEnvironments],
    };
  }, [connectedEnvironments]);

  const handlePairAgain = useCallback(
    (environmentId: EnvironmentId) => {
      const environment = savedEnvironments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      const prefill = environment ? environmentPairingPrefill(environment) : null;
      onChangeConnectionPairingUrl(prefill ?? "");
      props.onPairAgain(environmentId);
    },
    [onChangeConnectionPairingUrl, props, savedEnvironments],
  );

  const handleToggle = useCallback((environmentId: EnvironmentId) => {
    setExpandedId((current) => (current === environmentId ? null : environmentId));
  }, []);
  const handleUpdateEnvironment = useCallback(
    (
      environmentId: EnvironmentId,
      updates: { readonly label: string; readonly displayUrl: string },
    ) => {
      if (!SHOWCASE_ENABLED) return onUpdateEnvironment(environmentId, updates);
      const actualEnvironment = sections.localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      const presentedEnvironment = localEnvironments.find(
        (environment) => environment.environmentId === environmentId,
      );
      return onUpdateEnvironment(environmentId, {
        ...updates,
        displayUrl:
          actualEnvironment && presentedEnvironment
            ? resolveShowcaseEnvironmentUpdateDisplayUrl({
                actualDisplayUrl: actualEnvironment.displayUrl,
                presentedDisplayUrl: presentedEnvironment.displayUrl,
                submittedDisplayUrl: updates.displayUrl,
              })
            : updates.displayUrl,
      });
    },
    [localEnvironments, onUpdateEnvironment, sections.localEnvironments],
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-3 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      {savedEnvironments.length > 0 ? (
        <View collapsable={false} className="gap-3">
          <Text className="px-1 text-sm font-t3-bold uppercase text-foreground-muted">
            {translator.message("mobile.connection.savedOnDevice")}
          </Text>
          <View collapsable={false} className="overflow-hidden rounded-[24px] bg-card">
            {savedEnvironments.map((environment, index) => (
              <View
                key={environment.environmentId}
                collapsable={false}
                className={cn(index !== 0 && "border-t border-border")}
              >
                <ConnectionEnvironmentRow
                  environment={environment}
                  expanded={expandedId === environment.environmentId}
                  onToggle={() => handleToggle(environment.environmentId)}
                  onReconnect={onReconnectEnvironment}
                  onRemove={onRemoveEnvironmentPress}
                  onPairAgain={handlePairAgain}
                  onSignIn={props.onSignIn}
                  onUpdate={handleUpdateEnvironment}
                />
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View collapsable={false} className="items-center gap-3 rounded-[24px] bg-card px-6 py-8">
          <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-subtle">
            <SymbolView
              name="point.3.connected.trianglepath.dotted"
              size={20}
              tintColorClassName={"accent-icon-muted"}
              type="monochrome"
            />
          </View>
          <Text className="text-center text-sm leading-normal text-foreground-muted">
            {translator.message("mobile.connection.noneSaved")}
            {"\n"}
            {translator.message("mobile.connection.tapToAdd", { action: "+" })}
          </Text>
        </View>
      )}

      <CloudEnvironmentRows
        connectedCloudEnvironments={[]}
        onReconnectEnvironment={onReconnectEnvironment}
        {...(SHOWCASE_ENABLED
          ? {
              showcaseAvailableEnvironments: SHOWCASE_AVAILABLE_CLOUD_ENVIRONMENTS,
              showcaseSignedIn: true,
            }
          : {})}
      />
    </ScrollView>
  );
}
