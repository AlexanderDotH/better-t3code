import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { ArrowRightIcon } from "lucide-react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateReleaseUrl,
} from "./desktopUpdate.logic";
import { toastManager } from "./ui/toast";

type DesktopUpdateShell = Pick<DesktopBridge, "openExternal">;

function ReleaseNotesLink({
  shell,
  releaseUrl,
  translator,
}: {
  shell: DesktopUpdateShell;
  releaseUrl: string;
  translator: Pick<InterfaceTranslator, "message">;
}) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void (async () => {
          try {
            if (await shell.openExternal(releaseUrl)) return;
          } catch {
            // Surface rejected IPC calls through the same user-visible fallback.
          }
          toastManager.add({
            type: "error",
            title: translator.message("desktopUpdate.openNotesFailed"),
          });
        })();
      }}
      type="button"
    >
      {translator.message("desktopUpdate.readMore")}
      <ArrowRightIcon
        aria-hidden
        className="ml-1 inline size-3 -rotate-45 align-[-0.125em]"
        strokeWidth={2.25}
      />
    </button>
  );
}

export function showDesktopUpdateDownloadedToast(
  shell: DesktopUpdateShell,
  state: DesktopUpdateState,
  translator: Pick<InterfaceTranslator, "message">,
): void {
  const releaseUrl = getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state));
  toastManager.add({
    type: "success",
    title: translator.message("desktopUpdate.downloadedTitle"),
    description: (
      <>
        {translator.message("desktopUpdate.downloadedDescription")}
        {releaseUrl ? (
          <ReleaseNotesLink releaseUrl={releaseUrl} shell={shell} translator={translator} />
        ) : null}
      </>
    ),
  });
}
