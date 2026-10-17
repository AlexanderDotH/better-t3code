import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import type { ProjectChatSettings, ScopedProjectRef } from "@t3tools/contracts";
import type { ResolvedProjectChatSettings } from "@t3tools/client-runtime/project-chat-settings";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "./atom-registry";
import { serverEnvironment } from "./server";
import { setPendingConnectionError } from "./use-remote-environment-registry";

const EMPTY_PROJECT_CHAT_SETTINGS_ATOM = Atom.make<ProjectChatSettings | undefined>(undefined);

export function useRememberedProjectChatSettings(target: ScopedProjectRef | null) {
  return useAtomValue(
    target === null
      ? EMPTY_PROJECT_CHAT_SETTINGS_ATOM
      : serverEnvironment.projectChatSettingsValueAtom(target),
  );
}

export function getRememberedProjectChatSettings(target: ScopedProjectRef) {
  return appAtomRegistry.get(serverEnvironment.projectChatSettingsValueAtom(target));
}

export function rememberMobileProjectChatSettings(
  target: ScopedProjectRef,
  settings: ResolvedProjectChatSettings,
): void {
  void runAtomCommand(
    appAtomRegistry,
    serverEnvironment.rememberProjectChatSettings,
    { ...target, settings },
    { reportFailure: false, reportDefect: false },
  ).then((result) => {
    if (!AsyncResult.isFailure(result)) return;
    const error = Cause.squash(result.cause);
    setPendingConnectionError(
      error instanceof Error ? error.message : "Could not remember project chat settings.",
    );
  });
}
