import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const settingsHooks = vi.hoisted(() => ({
  read: vi.fn(() => ({ providerInstances: {} })),
  update: vi.fn(() => vi.fn()),
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: settingsHooks.read,
  useUpdateEnvironmentSettings: settingsHooks.update,
}));

import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";

const remoteEnvironmentId = EnvironmentId.make("remote-device");

describe("AddProviderInstanceDialog environment routing", () => {
  beforeEach(() => {
    settingsHooks.read.mockClear();
    settingsHooks.update.mockClear();
  });

  it("reads and writes settings through the supplied environment", () => {
    renderToStaticMarkup(
      <AddProviderInstanceDialog
        open
        environmentId={remoteEnvironmentId}
        environmentLabel="Remote device"
        onOpenChange={vi.fn()}
      />,
    );

    expect(settingsHooks.read).toHaveBeenCalledWith(remoteEnvironmentId);
    expect(settingsHooks.update).toHaveBeenCalledWith(remoteEnvironmentId);
  });
});
