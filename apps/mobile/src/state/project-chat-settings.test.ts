import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

const settingsWrite = vi.hoisted(() => ({
  run: vi.fn<() => Promise<AtomCommandResult<void, Error>>>(),
  reportError: vi.fn<(message: string) => void>(),
}));

vi.mock("./server", () => ({
  serverEnvironment: {
    rememberProjectChatSettings: {
      label: "Remember project chat settings",
      run: settingsWrite.run,
    },
  },
}));
vi.mock("./use-remote-environment-registry", () => ({
  setPendingConnectionError: settingsWrite.reportError,
}));

import { rememberMobileProjectChatSettings } from "./project-chat-settings";

afterEach(() => {
  settingsWrite.run.mockReset();
  settingsWrite.reportError.mockReset();
});

describe("mobile remembered settings errors", () => {
  it.each(["failure", "defect"] as const)("reports a persistence %s to the user", async (kind) => {
    const error = new Error("Could not save project chat settings.");
    if (kind === "failure") {
      settingsWrite.run.mockResolvedValue(AsyncResult.failure(Cause.fail(error)));
    } else {
      settingsWrite.run.mockRejectedValue(error);
    }
    const reported = new Promise<string>((resolve) => {
      settingsWrite.reportError.mockImplementationOnce(resolve);
    });

    rememberMobileProjectChatSettings(
      { environmentId: EnvironmentId.make("environment"), projectId: ProjectId.make("project") },
      {
        modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-test" },
        runtimeMode: "approval-required",
        composerMode: "plan",
      },
    );

    expect(await reported).toBe(error.message);
  });
});
