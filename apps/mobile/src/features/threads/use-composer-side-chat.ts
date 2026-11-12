import { MessageId, ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef } from "react";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export { parseSideChatCommand as parseMobileSideChatCommand } from "@t3tools/shared/composerTrigger";

export function useComposerSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly available: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const fork = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  const start = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const selectDetail = useSelectWorkspaceDetail();
  const pending = useRef(false);
  return async (prompt = "") => {
    if (!input.available || pending.current) return false;
    pending.current = true;
    const targetThreadId = ThreadId.make(uuidv4());
    return await (async () => {
      const result = await fork({
        environmentId: input.environmentId,
        input: {
          sourceThreadId: input.threadId,
          targetThreadId,
          title: translator.message("mobile.composer.sideChatTitle"),
          creationSource: "mobile",
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (prompt.trim()) {
        const sent = await start({
          environmentId: input.environmentId,
          input: {
            threadId: targetThreadId,
            message: {
              messageId: MessageId.make(uuidv4()),
              role: "user",
              text: prompt.trim(),
              attachments: [],
            },
            runtimeMode: "approval-required",
            interactionMode: "default",
            createdAt: new Date().toISOString(),
            creationSource: "mobile",
          },
        });
        if (sent._tag === "Failure") {
          await remove({
            environmentId: input.environmentId,
            input: { threadId: targetThreadId, onlyIfUnused: true },
          });
          throw squashAtomCommandFailure(sent);
        }
      }
      selectDetail({
        name: "Thread",
        params: { environmentId: input.environmentId, threadId: targetThreadId },
      });
      return true;
    })().finally(() => {
      pending.current = false;
    });
  };
}
