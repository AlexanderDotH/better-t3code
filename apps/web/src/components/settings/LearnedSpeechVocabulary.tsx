import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useContext, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

export function LearnedSpeechVocabulary({
  project,
  disabled,
}: {
  readonly project: EnvironmentProject;
  readonly disabled: boolean;
}) {
  const translate = useInterfaceTranslator().message;
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
  return (
    <div className="space-y-2 border-t border-border/60 pt-4">
      <h5 className="text-xs font-medium">{translate("settings.voice.learned.title")}</h5>
      <p className="text-xs text-muted-foreground">
        {translate("settings.voice.learned.description")}
      </p>
      <p className="break-words text-xs" role="status">
        {vocabulary.isPending
          ? translate("settings.voice.profile.loading")
          : vocabulary.error || failed
            ? translate("settings.voice.learned.failed")
            : vocabulary.data?.keyterms.join(", ") || translate("settings.voice.learned.empty")}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={
          disabled || !permitted || busy || (!vocabulary.error && !vocabulary.data?.keyterms.length)
        }
        onClick={() => void clearTerms()}
      >
        {translate("settings.voice.learned.clear")}
      </Button>
    </div>
  );
}
