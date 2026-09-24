import type { ProjectIndexQueryResultV1 } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ProjectIndexVerification(props: {
  readonly verification: ProjectIndexQueryResultV1["verification"];
}) {
  const translator = useMobileInterfaceTranslator();
  const verification = props.verification;

  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3">
      <Text className="text-sm font-t3-semibold text-foreground">
        {translator.message("projectIndexing.verification.title")}
      </Text>
      {verification ? (
        <>
          {verification.context === "provided" ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("projectIndexing.verification.contextProvided")}
            </Text>
          ) : null}
          <View className="gap-1">
            <Text className="text-sm text-foreground-muted">
              {translator.message(
                `projectIndexing.verification.sourceState.${verification.sourceHashes.state}`,
              )}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {translator.message("projectIndexing.verification.sourceHashes", {
                matched: verification.sourceHashes.matchedFiles,
                changed: verification.sourceHashes.changedFiles,
                missing: verification.sourceHashes.missingFiles,
                unverified: verification.sourceHashes.unverifiedFiles,
              })}
            </Text>
          </View>
          {verification.checks === "not-run" ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("projectIndexing.verification.checksNotRun")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text className="text-sm text-foreground-muted">
          {translator.message("projectIndexing.verification.unavailable")}
        </Text>
      )}
    </View>
  );
}
