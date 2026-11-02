import {
  EnvironmentId,
  type ClientSettings,
  type InterfaceLocaleSyncRecordV1,
} from "@t3tools/contracts";
// oxlint-disable-next-line t3code/require-disposable-render -- this Node lifecycle fixture verifies RPC acknowledgements without a browser; afterEach unmounts the renderer on every exit
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type LocalSettings = Pick<
  ClientSettings,
  "interfaceLocaleLocalRecordV1" | "interfaceLanguageLocalRecord"
>;
interface EnvironmentFixture {
  environmentId: EnvironmentId;
  label: string;
  connection: { phase: "connected" | "disconnected" };
  serverConfig: {
    environment: { capabilities: { environmentSettingsVersion: number } };
    settings: {
      interfaceLocaleSyncRecordV1: InterfaceLocaleSyncRecordV1 | null;
      interfaceLanguageSyncRecord: null;
    };
  };
}
const mocks = vi.hoisted(() => {
  const settings: LocalSettings = {
    interfaceLocaleLocalRecordV1: null,
    interfaceLanguageLocalRecord: null,
  };
  return {
    settings,
    environments: [] as EnvironmentFixture[],
    updateServer: vi.fn<() => Promise<{ _tag: "Success" | "Failure" }>>(),
  };
});
vi.mock("./hooks/useSettings", () => ({
  useClientSettings: (select: (settings: LocalSettings) => unknown) => select(mocks.settings),
  useClientSettingsHydrated: () => true,
  updateClientSettings: (patch: Partial<LocalSettings>) => Object.assign(mocks.settings, patch),
}));
vi.mock("./state/environments", () => ({
  useEnvironments: () => ({ environments: mocks.environments, isReady: true }),
}));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => mocks.updateServer }));

import {
  InterfaceLanguageSyncCoordinator,
  useInterfaceLanguageSyncStatus,
} from "./interfaceLanguageSync";

let root: ReactTestRenderer | undefined;
const localRecord: InterfaceLocaleSyncRecordV1 = {
  version: 1,
  preference: "fr",
  updatedAt: 100,
  updateId: "web:french",
};

function App() {
  const status = useInterfaceLanguageSyncStatus();
  return (
    <>
      <output>{JSON.stringify(status)}</output>
      <InterfaceLanguageSyncCoordinator />
    </>
  );
}
function status() {
  return root!.root.findByType("output").children.join("");
}

beforeEach(() => {
  // oxlint-disable-next-line t3code/require-disposable-render -- Node has no browser input outside act; afterEach restores this isolated worker's globals
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
  vi.stubGlobal("document", { documentElement: { lang: "" } });
  mocks.settings = {
    interfaceLocaleLocalRecordV1: localRecord,
    interfaceLanguageLocalRecord: null,
  };
  mocks.environments = [
    {
      environmentId: EnvironmentId.make("server"),
      label: "Laptop",
      connection: { phase: "connected" },
      serverConfig: {
        environment: { capabilities: { environmentSettingsVersion: 5 } },
        settings: { interfaceLocaleSyncRecordV1: null, interfaceLanguageSyncRecord: null },
      },
    },
  ];
  mocks.updateServer.mockReset();
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

it("stops showing syncing after the server acknowledges, before its snapshot catches up", async () => {
  let acknowledge!: (result: { _tag: "Success" }) => void;
  mocks.updateServer.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  await act(() => {
    root = create(<App />);
  });
  expect(status()).toContain('"isSyncing":true');
  expect(mocks.updateServer).toHaveBeenCalledTimes(1);
  await act(() => {
    acknowledge({ _tag: "Success" });
  });
  expect(status()).toContain('"isSyncing":false');
  expect(mocks.environments[0]?.serverConfig.settings.interfaceLocaleSyncRecordV1).toBeNull();
  await act(() => root!.update(<App />));
  expect(mocks.updateServer).toHaveBeenCalledTimes(1);
  mocks.environments[0]!.serverConfig.settings.interfaceLocaleSyncRecordV1 = localRecord;
  await act(() => root!.update(<App />));
  expect(status()).toContain('"isSyncing":false');
  expect(mocks.updateServer).toHaveBeenCalledTimes(1);
});

it("retains a failed preference for reconnection and retries it once the server returns", async () => {
  mocks.updateServer.mockResolvedValue({ _tag: "Failure" });
  await act(() => {
    root = create(<App />);
  });
  expect(status()).toContain('"failedEnvironmentLabels":["Laptop"]');
  expect(mocks.updateServer).toHaveBeenCalledTimes(1);
  mocks.environments[0]!.connection.phase = "disconnected";
  await act(() => root!.update(<App />));
  expect(status()).toContain('"deferredEnvironmentLabels":["Laptop"]');
  mocks.updateServer.mockResolvedValue({ _tag: "Success" });
  mocks.environments[0]!.connection.phase = "connected";
  await act(() => root!.update(<App />));
  expect(mocks.updateServer).toHaveBeenCalledTimes(2);
  expect(status()).toContain('"failedEnvironmentLabels":[]');
  expect(status()).toContain('"isSyncing":false');
});
