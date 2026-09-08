import { useAtomValue } from "@effect/atom-react";
import { shouldOfferProjectSpeechPreindex } from "@t3tools/client-runtime/prompt-improvement";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveBetterT3FeatureFlag, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { toastManager } from "../ui/toast";
import { useEffect, useState, type RefObject } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  ProjectSpeechPreindexDialog,
  type ProjectSpeechPreindexDialogState,
} from "./ProjectSpeechPreindexDialog";
import { resolveAssemblyAiVoiceInputAvailability } from "./voiceInputAvailability";

export function ProjectSpeechSetup({
  environmentId,
  projectId,
  projectTitle,
  promptRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly promptRef: RefObject<string>;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const secret = settings.speechTranscription.assemblyAi.apiKey;
  const configured = resolveAssemblyAiVoiceInputAvailability({
    featureEnabled: resolveBetterT3FeatureFlag(settings.betterT3Environment, "voice.assemblyAi"),
    environmentSettingsVersion: config?.environment.capabilities.environmentSettingsVersion,
    apiKeyConfigured: secret.value.trim().length > 0 || secret.valueRedacted === true,
  }).configured;
  const getProfile = useAtomCommand(serverEnvironment.getProjectSpeechProfile, {
    reportFailure: false,
  });
  const indexProfile = useAtomCommand(serverEnvironment.indexProjectSpeechProfile, {
    reportFailure: false,
  });
  const createBasic = useAtomCommand(serverEnvironment.createBasicProjectSpeechProfile, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<ProjectSpeechPreindexDialogState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  useEffect(() => {
    if (!configured || dismissed) return;
    let cancelled = false;
    void getProfile({ environmentId, input: { projectId } }).then((result) => {
      if (cancelled || result._tag === "Failure") return;
      if (
        shouldOfferProjectSpeechPreindex({
          voiceInputConfigured: configured,
          routeKind: "draft",
          hasProjectSpeechProfile: result.value !== null,
          hasStartedThread: false,
          prompt: promptRef.current,
        })
      )
        setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [configured, dismissed, environmentId, getProfile, projectId, promptRef]);
  const close = () => {
    setDismissed(true);
    setOpen(false);
  };
  const create = async (index: boolean) => {
    if (state === "indexing" || state === "creating-basic") return;
    setState(index ? "indexing" : "creating-basic");
    const input = { environmentId, input: { projectId } };
    const result = await (index ? indexProfile(input) : createBasic(input));
    if (result._tag === "Success") {
      if (index) close();
      else setState("basic");
      return;
    }
    setErrorMessage(String(squashAtomCommandFailure(result)));
    if (index) {
      const fallback = await createBasic(input);
      if (fallback._tag === "Success") {
        setState("error");
        return;
      }
      toastManager.add({
        type: "error",
        title: "Could not create speech profile",
        description: String(squashAtomCommandFailure(fallback)),
      });
      setState("idle");
      return;
    }
    toastManager.add({
      type: "error",
      title: "Could not create speech profile",
      description: String(squashAtomCommandFailure(result)),
    });
    setState("idle");
  };
  return (
    <ProjectSpeechPreindexDialog
      open={open}
      projectTitle={projectTitle}
      state={state}
      {...(errorMessage ? { errorMessage } : {})}
      onIndex={() => void create(true)}
      onUseBasic={() => void create(false)}
      onSkip={close}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    />
  );
}
