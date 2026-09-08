import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { useCallback, useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";

export function useSettingsCommand<W, A, E>(command: AtomCommand<W, A, E>) {
  const run = useAtomCommand(command, { reportFailure: false });
  return useCallback(
    async (input: W): Promise<A> => {
      const result = await run(input);
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      return result.value;
    },
    [run],
  );
}

export function useSettingsMutation<A, W = void>(options: {
  readonly mutationFn: (input: W) => Promise<A>;
  readonly onMutate?: (input: W) => void;
  readonly onSettled?: (input: W) => void;
  readonly onSuccess?: (result: A, input: W) => void;
  readonly onError?: (error: unknown, input: W) => void;
}) {
  const running = useRef(false);
  const [state, setState] = useState<
    | { readonly isPending: false; readonly variables?: W }
    | { readonly isPending: true; readonly variables: W }
  >({ isPending: false });
  const mutate = (input: W) => {
    if (running.current) return;
    running.current = true;
    setState({ isPending: true, variables: input });
    void Promise.resolve()
      .then(() => {
        options.onMutate?.(input);
        return options.mutationFn(input);
      })
      .then(
        (result) => options.onSuccess?.(result, input),
        (error: unknown) => options.onError?.(error, input),
      )
      .finally(() => {
        running.current = false;
        setState({ isPending: false });
        options.onSettled?.(input);
      });
  };
  return { ...state, mutate };
}
