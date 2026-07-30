import { describe, expect, it } from "vite-plus/test";

import { normalizeCursorSdkCatalog, resolveCursorModelSelection } from "./CursorSdkCatalog.ts";
import {
  forceStopCursorSdkState,
  runCursorSdkTurn,
  stopCursorSdkState,
  type CursorSdkTurnState,
} from "./CursorSdkClient.ts";
import { isPlausibleCursorSessionJwt, normalizeCursorSdkApiKey } from "./CursorSdkKey.ts";
import { buildCursorTurnOutcome } from "./CursorSdkOutcome.ts";

describe("CursorSdk helpers", () => {
  it("normalizes API key wrappers without accepting short or malformed tokens as session JWTs", () => {
    const jwt = `eyJ${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(10)}`;

    expect(normalizeCursorSdkApiKey(`Bearer ${jwt}`)).toBe(jwt);
    expect(normalizeCursorSdkApiKey(JSON.stringify({ access_token: jwt }))).toBe(jwt);
    expect(isPlausibleCursorSessionJwt(jwt)).toBe(true);
    expect(isPlausibleCursorSessionJwt("not-a-jwt")).toBe(false);
  });

  it("normalizes model catalog variants and recovers legacy wire IDs", () => {
    const catalog = normalizeCursorSdkCatalog([
      {
        id: "composer-2.5",
        displayName: "Composer 2.5",
        aliases: ["composer-latest"],
        variants: [
          {
            displayName: "Composer 2.5 Fast",
            params: [{ id: "speed", value: "fast" }],
          },
        ],
      },
    ]);

    expect(catalog.pickerRows.map((row) => row.id)).toEqual([
      "composer-2.5",
      "composer-latest",
      "composer-2-5-fast",
    ]);
    expect(catalog.selectionByWireId.get("composer-2-5-fast")).toEqual({
      id: "composer-2.5",
      params: [{ id: "speed", value: "fast" }],
    });
    expect(resolveCursorModelSelection("composer-2.5-fast", catalog.selectionByWireId)).toEqual({
      id: "composer-2.5",
      params: [{ id: "speed", value: "fast" }],
    });
  });

  it("uses streamed text when Cursor returns an empty result and preserves diagnostics", () => {
    expect(buildCursorTurnOutcome({ status: "finished", result: "" }, "streamed reply")).toEqual({
      ok: true,
      text: "streamed reply",
      status: "finished",
    });

    expect(buildCursorTurnOutcome({ status: "error" }, "", ["tool failed"])).toEqual({
      ok: false,
      text: "",
      status: "error",
      error: "tool failed",
    });
  });

  it("cancels the active Cursor SDK run before closing its agent runtime", async () => {
    const calls: string[] = [];
    const state = {
      agent: {
        send: async () => {
          throw new Error("unused");
        },
        close: async () => {
          calls.push("close");
        },
      },
      activeRun: {
        stream: async function* () {
          return;
        },
        wait: async () => ({}),
        supports: (capability: string) => capability === "cancel",
        cancel: async () => {
          calls.push("cancel");
        },
      },
      apiKey: "cursor_test",
      cwd: process.cwd(),
      wireModelId: "composer-2",
    } as CursorSdkTurnState & {
      activeRun: {
        cancel: () => Promise<void>;
      };
    };

    await stopCursorSdkState(state);

    expect(calls).toEqual(["cancel", "close"]);
    expect(state.agent).toBeUndefined();
    expect(state.activeRun).toBeUndefined();
  });

  it("reports a confirmed Cursor SDK runtime close", async () => {
    const calls: string[] = [];
    const state = {
      agent: {
        send: async () => {
          throw new Error("unused");
        },
        close: async () => {
          calls.push("close");
        },
      },
      activeRun: undefined,
      apiKey: "cursor_test",
      cwd: process.cwd(),
      wireModelId: "composer-2",
    } as CursorSdkTurnState;

    const result = await forceStopCursorSdkState(state);

    expect(result).toEqual({
      outcome: "terminated",
      mechanism: "runtime-close",
      detail: "The Cursor SDK agent runtime was closed.",
    });
    expect(calls).toEqual(["close"]);
  });

  it("reports a confirmed Cursor SDK run cancellation when no agent close is available", async () => {
    const state = {
      agent: undefined,
      activeRun: {
        stream: async function* () {
          return;
        },
        wait: async () => ({}),
        cancel: async () => undefined,
      },
      apiKey: "cursor_test",
      cwd: process.cwd(),
      wireModelId: "composer-2",
    } as CursorSdkTurnState;

    expect(await forceStopCursorSdkState(state)).toEqual({
      outcome: "terminated",
      mechanism: "remote-cancel",
      detail: "The active Cursor SDK run was cancelled.",
    });
  });

  it("treats an empty Cursor SDK runtime state as already stopped", async () => {
    const state: CursorSdkTurnState = {
      agent: undefined,
      activeRun: undefined,
      apiKey: undefined,
      cwd: undefined,
      wireModelId: undefined,
    };

    expect(await forceStopCursorSdkState(state)).toEqual({
      outcome: "terminated",
      mechanism: "already-stopped",
    });
  });

  it("closes a newly created Cursor SDK agent without sending when force-stop already aborted", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const state: CursorSdkTurnState = {
      agent: undefined,
      activeRun: undefined,
      apiKey: undefined,
      cwd: undefined,
      wireModelId: undefined,
    };

    const result = await runCursorSdkTurn({
      apiKey: "cursor_test",
      cwd: process.cwd(),
      wireModelId: "composer-2",
      userText: "do not send",
      state,
      signal: controller.signal,
      importer: async () => ({
        Agent: {
          create: async () => {
            calls.push("create");
            return {
              send: async () => {
                calls.push("send");
                throw new Error("send should not run");
              },
              close: async () => {
                calls.push("close");
              },
            };
          },
        },
        Cursor: {
          models: {
            list: async () => [],
          },
          me: async () => ({}),
        },
      }),
    });

    expect(result.status).toBe("cancelled");
    expect(calls).toEqual(["create", "close"]);
    expect(state.agent).toBeUndefined();
  });
});
