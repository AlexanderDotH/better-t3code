import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useContext, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function LearnedSpeechVocabulary({ project }: { readonly project: EnvironmentProject }) {
  const translate = useMobileInterfaceTranslator().message;
  const registry = useContext(RegistryContext);
  const query = serverEnvironment.learnedSpeechVocabularyQuery({
    environmentId: project.environmentId,
    input: { projectId: project.id },
  });
  const vocabulary = useEnvironmentQuery(query);
  const permitted = useAtomValue(
    serverEnvironment.clearLearnedSpeechVocabulary.permissionAtom(project.environmentId),
  );
  const clear = useAtomCommand(serverEnvironment.clearLearnedSpeechVocabulary, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const clearTerms = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await clear({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      });
      if (result._tag === "Failure") setFailed(true);
      else registry.refresh(query);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  const disabled = !permitted || busy || (!vocabulary.error && !vocabulary.data?.keyterms.length);
  return (
    <View className="gap-2 border-t border-border-subtle pt-3">
      <Text className="text-xs font-t3-medium text-foreground">
        {translate("settings.voice.learned.title")}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {translate("settings.voice.learned.description")}
      </Text>
      <Text selectable className="text-xs text-foreground-muted">
        {vocabulary.isPending
          ? translate("settings.voice.profile.loading")
          : vocabulary.error || failed
            ? translate("settings.voice.learned.failed")
            : vocabulary.data?.keyterms.join(", ") || translate("settings.voice.learned.empty")}
      </Text>
      <View className="flex-row">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          onPress={() => void clearTerms()}
          className="rounded-xl bg-subtle px-4 py-2 disabled:opacity-40"
        >
          <Text className="font-t3-medium text-foreground">
            {translate("settings.voice.learned.clear")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
