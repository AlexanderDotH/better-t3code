import { EnvironmentId, DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1 } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const configurations = vi.hoisted(() => new Map<string | null, unknown>());
vi.mock("../state/server", () => ({
  serverEnvironment: { configValueAtom: (environmentId: string | null) => environmentId },
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (environmentId: string | null) => configurations.get(environmentId) ?? null,
}));

import { useVisualizationsEnabled } from "./useVisualizationsEnabled";

it("uses the selected environment's capability and current flag without falling back to another server", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const first = EnvironmentId.make("visualizations-first");
  const second = EnvironmentId.make("visualizations-second");
  const config = (enabled: boolean, version?: number) => ({
    environment: { capabilities: { visualizationsVersion: version } },
    settings: {
      betterT3Environment: {
        ...DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
        flags: { "chat.visualizations": enabled },
      },
    },
  });
  const observed: boolean[] = [];
  function ReadFeature({ environmentId }: { environmentId: EnvironmentId | null }) {
    observed.push(useVisualizationsEnabled(environmentId));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    configurations.set(first, config(true, 1));
    configurations.set(second, config(false, 1));
    await act(async () => {
      renderer = create(<ReadFeature environmentId={first} />);
    });
    expect(observed.at(-1)).toBe(true);
    await act(async () => {
      renderer!.update(<ReadFeature environmentId={second} />);
    });
    expect(observed.at(-1)).toBe(false);
    configurations.set(second, config(true));
    await act(async () => {
      renderer!.update(<ReadFeature environmentId={second} />);
    });
    expect(observed.at(-1)).toBe(false);
    configurations.set(second, config(true, 1));
    await act(async () => {
      renderer!.update(<ReadFeature environmentId={second} />);
    });
    expect(observed.at(-1)).toBe(true);
    await act(async () => {
      renderer!.update(<ReadFeature environmentId={null} />);
    });
    expect(observed.at(-1)).toBe(false);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    configurations.clear();
    vi.unstubAllGlobals();
  }
});
