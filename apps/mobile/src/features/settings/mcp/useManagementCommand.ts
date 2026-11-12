import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { useAtomCommand } from "../../../state/use-atom-command";
import { ManagementFormError } from "./mcp-form";

export function useManagementCommand<A, E, W>(command: AtomCommand<W, A, E>) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (input: W) => {
    const result = await run(input);
    if (result._tag === "Success") return result.value;
    if (isAtomCommandInterrupted(result)) return null;
    throw squashAtomCommandFailure(result);
  };
}

export function useManagementTask() {
  const translator = useMobileInterfaceTranslator();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    await (async () => {
      await action();
    })()
      .catch((failure) => {
        setError(
          failure instanceof ManagementFormError
            ? translator.message(failure.messageKey)
            : failure instanceof Error
              ? failure.message
              : translator.message("mobile.mcp.requestFailed"),
        );
      })
      .finally(() => {
        running.current = false;
        setPending(false);
      });
  };
  return { run, pending, error };
}
