import type * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as Effect from "effect/Effect";

export const readCodexThreadTurns = Effect.fn("CodexHistory.readThreadTurns")(function* (
  client: Pick<CodexClient.CodexAppServerClient["Service"], "request">,
  threadId: string,
) {
  const turns: Array<CodexSchema.V2ThreadTurnsListResponse["data"][number]> = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: CodexSchema.V2ThreadTurnsListResponse = yield* client.request("thread/turns/list", {
      threadId,
      cursor,
      limit: 100,
      sortDirection: "asc",
      itemsView: "full",
    });
    turns.push(...page.data);
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (visited.has(cursor))
        return yield* CodexErrors.CodexAppServerRequestError.internalError(
          "Thread history pagination repeated a cursor.",
          undefined,
          { method: "thread/turns/list", operation: "decode-payload" },
        );
      visited.add(cursor);
    }
  } while (cursor !== null);
  return turns;
});
