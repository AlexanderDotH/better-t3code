import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const {
  askForMediaAccessMock,
  focusedWebContents,
  setPermissionCheckHandlerMock,
  setPermissionRequestHandlerMock,
} = vi.hoisted(() => ({
  askForMediaAccessMock: vi.fn(() => Promise.resolve(true)),
  focusedWebContents: {},
  setPermissionCheckHandlerMock: vi.fn(),
  setPermissionRequestHandlerMock: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => ({ webContents: focusedWebContents })),
  },
  session: {
    defaultSession: {
      setPermissionCheckHandler: setPermissionCheckHandlerMock,
      setPermissionRequestHandler: setPermissionRequestHandlerMock,
    },
  },
  systemPreferences: {
    askForMediaAccess: askForMediaAccessMock,
  },
}));

import * as ElectronMediaPermissions from "./ElectronMediaPermissions.ts";

describe("ElectronMediaPermissions", () => {
  beforeEach(() => {
    askForMediaAccessMock.mockClear();
    setPermissionCheckHandlerMock.mockClear();
    setPermissionRequestHandlerMock.mockClear();
  });

  it("recognizes main-frame audio requests from the desktop application only", () => {
    assert.isTrue(
      ElectronMediaPermissions.isDesktopAudioPermissionRequest({
        applicationUrl: "t3code://app/",
        isMainFrame: true,
        mediaTypes: ["audio"],
        requestingUrl: "t3code://app/thread/123",
      }),
    );
    assert.isFalse(
      ElectronMediaPermissions.isDesktopAudioPermissionRequest({
        applicationUrl: "t3code://app/",
        isMainFrame: true,
        mediaTypes: ["video", "audio"],
        requestingUrl: "t3code://app/thread/123",
      }),
    );
    assert.isFalse(
      ElectronMediaPermissions.isDesktopAudioPermissionRequest({
        applicationUrl: "t3code://app/",
        isMainFrame: true,
        mediaTypes: ["audio"],
        requestingUrl: "https://example.com/",
      }),
    );
  });

  it.effect("asks macOS only when the user requests microphone capture", () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const permissions = yield* ElectronMediaPermissions.ElectronMediaPermissions;
          yield* permissions.configure({
            applicationUrl: "t3code://app/",
            platform: "darwin",
          });

          assert.equal(askForMediaAccessMock.mock.calls.length, 0);
          const handler = setPermissionRequestHandlerMock.mock.calls[0]?.[0];
          assert.isFunction(handler);

          const callback = vi.fn();
          handler(focusedWebContents, "media", callback, {
            isMainFrame: true,
            mediaTypes: ["audio"],
            requestingUrl: "t3code://app/thread/123",
          });
          yield* Effect.promise(() => Promise.resolve());

          assert.deepEqual(askForMediaAccessMock.mock.calls, [["microphone"]]);
          assert.deepEqual(callback.mock.calls, [[true]]);
        }),
      );

      assert.strictEqual(setPermissionCheckHandlerMock.mock.calls.at(-1)?.[0], null);
      assert.strictEqual(setPermissionRequestHandlerMock.mock.calls.at(-1)?.[0], null);
    }).pipe(Effect.provide(ElectronMediaPermissions.layer)),
  );

  it.effect("rejects capture requests from non-app content without prompting macOS", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const permissions = yield* ElectronMediaPermissions.ElectronMediaPermissions;
        yield* permissions.configure({
          applicationUrl: "t3code://app/",
          platform: "darwin",
        });
        const handler = setPermissionRequestHandlerMock.mock.calls[0]?.[0];
        const callback = vi.fn();

        handler(focusedWebContents, "media", callback, {
          isMainFrame: true,
          mediaTypes: ["audio"],
          requestingUrl: "https://example.com/",
        });

        assert.equal(askForMediaAccessMock.mock.calls.length, 0);
        assert.deepEqual(callback.mock.calls, [[false]]);
      }),
    ).pipe(Effect.provide(ElectronMediaPermissions.layer)),
  );

  it.effect("preserves Electron's existing behavior for unrelated permissions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const permissions = yield* ElectronMediaPermissions.ElectronMediaPermissions;
        yield* permissions.configure({
          applicationUrl: "t3code://app/",
          platform: "darwin",
        });
        const handler = setPermissionRequestHandlerMock.mock.calls[0]?.[0];
        const callback = vi.fn();

        handler(focusedWebContents, "fullscreen", callback, {
          isMainFrame: true,
          requestingUrl: "t3code://app/",
        });

        assert.equal(askForMediaAccessMock.mock.calls.length, 0);
        assert.deepEqual(callback.mock.calls, [[true]]);
      }),
    ).pipe(Effect.provide(ElectronMediaPermissions.layer)),
  );
});
