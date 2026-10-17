// Minimal codex app-server stand-in for runtime-level collab tests.
// Speaks just enough of the protocol for CodexSessionRuntime to start a
// session, using REAL captured responses (codexMultiAgentWire.json), then
// replays a scripted multi-agent notification sequence read from the
// T3_CODEX_COLLAB_SCRIPT env var (a JSON file path) when the first turn
// starts. Runs as a plain Node process — stdlib only.
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  NodeFS.readFileSync(NodePath.join(here, "codexMultiAgentWire.json"), "utf8"),
);
const script = JSON.parse(NodeFS.readFileSync(process.env.T3_CODEX_COLLAB_SCRIPT, "utf8"));

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let turnStartCount = 0;
let activeTurn;
let activeCompaction;
let compactionCount = 0;
let contextRequestFailed = false;

const startCompaction = (manual, turn) => {
  compactionCount += 1;
  activeCompaction = {
    manual,
    turn: turn ?? { ...fixture.responses.turnStart.turn, id: `compact-${compactionCount}` },
    item: { id: `compact-item-${compactionCount}`, type: "contextCompaction" },
  };
  if (manual && !script.legacyCompaction) {
    write({
      jsonrpc: "2.0",
      method: "turn/started",
      params: { threadId: script.rootThreadId, turn: activeCompaction.turn },
    });
  }
  write({
    jsonrpc: "2.0",
    method: "item/started",
    params: {
      threadId: script.rootThreadId,
      turnId: activeCompaction.turn.id,
      item: activeCompaction.item,
      startedAtMs: 1_778_000_000_000,
    },
  });
};

const finishCompaction = () => {
  if (!activeCompaction) return;
  const pending = activeCompaction;
  activeCompaction = undefined;
  if (script.legacyCompaction) {
    write({
      jsonrpc: "2.0",
      method: "thread/compacted",
      params: { threadId: script.rootThreadId, turnId: pending.turn.id },
    });
    return;
  }
  if (script.failCompaction) {
    write({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: script.rootThreadId,
        turn: {
          ...pending.turn,
          status: "failed",
          error: {
            message: "Compaction fixture failed.",
            codexErrorInfo: null,
            additionalDetails: null,
          },
        },
      },
    });
    return;
  }
  write({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: script.rootThreadId,
      turnId: pending.turn.id,
      item: pending.item,
      completedAtMs: 1_778_000_000_001,
    },
  });
  if (pending.manual) {
    write({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: script.rootThreadId,
        turn: { ...pending.turn, status: "completed" },
      },
    });
  }
};

// Server->client requests the runtime must answer (approval prompts), keyed
// by the numeric JSON-RPC id this peer allocated for them.
const openServerRequests = new Map();
const rl = NodeReadline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method } = message;
  if (openServerRequests.has(id)) {
    // The runtime answered an approval request. Record the response so tests
    // can assert settlement behavior, then emit serverRequest/resolved as a
    // deterministic receipt (tests wait on the runtime's event stream rather
    // than polling the sidecar file). Real codex identifies the resolved
    // request by its item id — the key the runtime correlates on — so the
    // receipt exercises the same path that closes the approval card in the
    // UI.
    const request = openServerRequests.get(id);
    openServerRequests.delete(id);
    NodeFS.appendFileSync(
      `${process.env.T3_CODEX_COLLAB_SCRIPT}.approvalResponses`,
      `${JSON.stringify({ id, label: request.label, result: message.result ?? null })}\n`,
    );
    write({
      jsonrpc: "2.0",
      method: "serverRequest/resolved",
      params: {
        threadId: script.rootThreadId,
        requestId: request.itemId ?? request.label,
      },
    });
    return;
  }
  if (method === undefined && script.serverRequests?.some((request) => request.id === id)) {
    NodeFS.appendFileSync(
      `${process.env.T3_CODEX_COLLAB_SCRIPT}.responses`,
      `${JSON.stringify({ id, result: message.result, error: message.error })}\n`,
    );
    if (script.completeTurnOnServerResponse && activeTurn) {
      write({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: script.rootThreadId,
          turn: { ...activeTurn, status: "completed" },
        },
      });
    }
    return;
  }
  if (method === "initialize") {
    write({
      id,
      result: {
        userAgent: "t3-collab-mock/0.0.0",
        codexHome: "/tmp",
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
    return;
  }
  if (method === "account/read") {
    write({
      id,
      result: { account: script.account ?? { type: "apiKey" }, requiresOpenaiAuth: false },
    });
    return;
  }
  if (method === "account/rateLimits/read" && script.failRateLimitsRead) {
    write({ id, error: { code: -32000, message: "usage unavailable" } });
    return;
  }
  if (method === "account/rateLimitResetCredit/consume" && script.resetCreditOutcome) {
    write({ id, result: { outcome: script.resetCreditOutcome } });
    return;
  }
  if (method === "skills/list" || method === "model/list") {
    write({ id, result: { data: [] } });
    return;
  }
  if (method === "thread/start") {
    write({ id, result: fixture.responses.threadStart });
    return;
  }
  if (method === "thread/inject_items" && script.recordRequests) {
    NodeFS.appendFileSync(
      `${process.env.T3_CODEX_COLLAB_SCRIPT}.requests`,
      `${JSON.stringify({ method, params: message.params })}\n`,
    );
    write({ id, result: {} });
    return;
  }
  if (method === "thread/resume") {
    if (script.recordRequests) {
      NodeFS.appendFileSync(
        `${process.env.T3_CODEX_COLLAB_SCRIPT}.requests`,
        `${JSON.stringify({ method, params: message.params })}\n`,
      );
    }
    const threadId = message.params?.threadId;
    const childSnapshot = script.childResumeSnapshots?.[threadId];
    if (script.resumeRequestMarker) {
      write({
        jsonrpc: "2.0",
        method: "serverRequest/resolved",
        params: {
          threadId: script.rootThreadId,
          requestId: script.resumeRequestMarker,
        },
      });
    }
    if (childSnapshot?.hang) {
      return;
    }
    if (childSnapshot?.error) {
      write({ id, error: { code: -32000, message: childSnapshot.error } });
      return;
    }
    if (childSnapshot) {
      write({
        id,
        result: {
          ...fixture.responses.threadStart,
          model: childSnapshot.model,
          reasoningEffort: childSnapshot.reasoningEffort,
          thread: {
            ...fixture.responses.threadStart.thread,
            id: threadId,
            sessionId: threadId,
          },
        },
      });
      for (const notification of childSnapshot.notifications ?? []) {
        write({ jsonrpc: "2.0", method: notification.method, params: notification.params });
      }
      return;
    }
    write({ id, result: fixture.responses.threadStart });
    return;
  }
  if (method === "thread/read" && script.failTransportOnRead === true) {
    process.stdout.write("{malformed-json}\n");
    return;
  }
  if (method === "thread/compact/start") {
    write({ id, result: {} });
    startCompaction(true);
    if (script.holdCompaction !== true) finishCompaction();
    return;
  }
  if (method === "thread/read") {
    finishCompaction();
    write({ id, result: { thread: fixture.responses.threadStart.thread } });
    return;
  }
  if (method === "turn/start") {
    if (script.recordTurnRequests) {
      NodeFS.appendFileSync(
        `${process.env.T3_CODEX_COLLAB_SCRIPT}.turnRequests`,
        `${JSON.stringify(message.params)}\n`,
      );
    }
    if (script.turnStartError) {
      write({ id, error: { code: -32603, message: script.turnStartError } });
      return;
    }
    if (script.compactOnFirstInput && compactionCount === 0) {
      if (script.completeCompactionBeforeRejection) {
        startCompaction(true);
        finishCompaction();
      }
      write({
        id,
        error: {
          code: -32603,
          message: "failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }",
        },
      });
      if (!script.completeCompactionBeforeRejection) startCompaction(true);
      return;
    }
    if (activeCompaction) {
      write({
        id,
        error: {
          code: -32603,
          message: "failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }",
        },
      });
      return;
    }
    if (script.contextFullOnFirstTurn === "request" && !contextRequestFailed) {
      contextRequestFailed = true;
      write({
        id,
        error: {
          code: -32603,
          message: "Your input exceeds the context window of this model.",
        },
      });
      return;
    }
    const turnId = script.turnIds?.[turnStartCount];
    const turn = turnId
      ? { ...fixture.responses.turnStart.turn, id: turnId }
      : fixture.responses.turnStart.turn;
    activeTurn = turn;
    turnStartCount += 1;
    if (script.replyAfterTurnCompleted !== true) {
      write({ id, result: { ...fixture.responses.turnStart, turn } });
    }
    const rootThreadId = script.rootThreadId;
    if (script.onlyFirstTurnStarts !== true || turnStartCount === 1) {
      write({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: rootThreadId, turn },
      });
    }
    if (script.compactBeforeFirstTurn && turnStartCount === 1) {
      startCompaction(false, turn);
      return;
    }
    if (script.contextFullOnFirstTurn === "notification" && turnStartCount === 1) {
      const error = {
        message: "The context window is full.",
        codexErrorInfo: "contextWindowExceeded",
        additionalDetails: null,
      };
      write({
        jsonrpc: "2.0",
        method: "error",
        params: { threadId: rootThreadId, turnId: turn.id, willRetry: false, error },
      });
      write({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { threadId: rootThreadId, turn: { ...turn, status: "failed", error } },
      });
      return;
    }
    if (script.contextFullOnFirstTurn === "usage" && turnStartCount === 1) {
      const usage = {
        inputTokens: 100_000,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 100_000,
      };
      write({
        jsonrpc: "2.0",
        method: "thread/tokenUsage/updated",
        params: {
          threadId: rootThreadId,
          turnId: turn.id,
          tokenUsage: { last: usage, total: usage, modelContextWindow: 100_000 },
        },
      });
    }
    for (const notification of script.notifications) {
      write({ jsonrpc: "2.0", method: notification.method, params: notification.params });
    }
    for (const [index, request] of (script.serverRequests ?? []).entries()) {
      if (request.id !== undefined) {
        // Legacy form: caller-supplied JSON-RPC ids recorded in .responses.
        write({ jsonrpc: "2.0", id: request.id, method: request.method, params: request.params });
        continue;
      }
      // Scripted server->client requests (approval prompts). String values in
      // params may reference "${threadId}" / "${turnId}" placeholders that are
      // substituted with the ids this peer actually allocated.
      const requestId = 9000 + index;
      const label = request.label ?? `approval-${requestId}`;
      openServerRequests.set(requestId, { label, itemId: request.params?.itemId });
      const params = JSON.parse(
        JSON.stringify(request.params)
          .replaceAll("${threadId}", String(rootThreadId))
          .replaceAll("${turnId}", String(turn.id)),
      );
      write({ jsonrpc: "2.0", id: requestId, method: request.method, params });
    }
    if (script.holdTurnOpen !== true) {
      write({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: rootThreadId,
          turn: { ...turn, status: "completed" },
        },
      });
    }
    if (script.replyAfterTurnCompleted === true) {
      write({ id, result: { ...fixture.responses.turnStart, turn } });
    }
    return;
  }
  if (method === "turn/interrupt") {
    // Record which thread/turn was interrupted (append-only sidecar file the
    // test reads) so Stop coverage can assert every live child was reached.
    // failInterruptFor simulates a dead child whose interrupt errors.
    const target = message.params?.threadId;
    NodeFS.appendFileSync(
      `${process.env.T3_CODEX_COLLAB_SCRIPT}.interrupts`,
      `${JSON.stringify({ threadId: target, turnId: message.params?.turnId })}\n`,
    );
    if (
      script.expectedActiveTurnId &&
      message.params?.threadId === script.rootThreadId &&
      message.params?.turnId !== script.expectedActiveTurnId
    ) {
      write({
        id,
        error: {
          code: -32000,
          message: `expected active turn id ${message.params?.turnId} but found ${script.expectedActiveTurnId}`,
        },
      });
      return;
    }
    if (script.failInterruptFor && script.failInterruptFor === target) {
      write({ id, error: { code: -32000, message: "thread already closed" } });
      if (target === script.rootThreadId) {
        write({
          jsonrpc: "2.0",
          method: "serverRequest/resolved",
          params: { threadId: target, requestId: "failed-interrupt" },
        });
      }
      return;
    }
    if (script.hangInterruptFor && script.hangInterruptFor === target) {
      // Never respond: simulates a wedged child whose RPC neither resolves
      // nor rejects. The runtime's bounded deadline must move on.
      return;
    }
    write({ id, result: {} });
    if (script.compactBeforeFirstTurn && activeTurn?.id === message.params?.turnId) {
      write({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: script.rootThreadId,
          turn: { ...activeTurn, status: "interrupted" },
        },
      });
    }
    return;
  }
  if (id !== undefined) {
    write({ id, result: {} });
  }
});
