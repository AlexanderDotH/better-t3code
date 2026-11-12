import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const NO_SHARE_PERMISSION = Atom.make(false);

export function useThreadGuestSharing(threadRef: ScopedThreadRef | null) {
  const t = useMobileInterfaceTranslator();
  const create = useAtomCommand(serverEnvironment.createGuestShare, { reportFailure: false });
  const allowed = useAtomValue(
    threadRef
      ? serverEnvironment.createGuestShare.permissionAtom(threadRef.environmentId)
      : NO_SHARE_PERMISSION,
  );
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const createAndCopy = async () => {
    if (!threadRef || !allowed || busy.current) return;
    busy.current = true;
    setPending(true);
    await (async () => {
      const result = await create({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      await Clipboard.setStringAsync(result.value.url);
      Dialog.alert(t.message("mobile.panels.copied"));
    })()
      .catch((error) => {
        Dialog.alert(
          t.message("mobile.panels.failed"),
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        busy.current = false;
        setPending(false);
      });
  };
  return { allowed, pending, createAndCopy };
}
