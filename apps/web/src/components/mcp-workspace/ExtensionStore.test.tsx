import { EnvironmentId, type ExtensionCatalogSearchInput } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "store-env",
        {
          environment: { capabilities: { extensionStoreVersion: 1 } },
          settings: { mcp: { servers: [] } },
        },
      ],
    ]),
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (data: unknown) => ({
    data,
    isPending: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("~/state/agentSettings", () => ({
  agentSettingsEnvironment: {
    catalogSearchQuery: ({ input }: { input: ExtensionCatalogSearchInput }) => ({
      entries: [
        {
          id: "example/skills/" + (input.query || "suggested-skill"),
          name: input.query || "suggested-skill",
          kind: input.kind,
          source: "example/skills",
          sourceUrl: "https://skills.sh/example/skills/suggested-skill",
          description: "A skill to try",
          connections: [],
        },
      ],
    }),
    skills: { listQuery: () => ({ skills: [] }) },
    mcp: { sessionAccess: () => ({ scopes: ["orchestration:operate"] }) },
  },
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, onClick }: ComponentProps<"button">) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock("../ui/input", () => ({ Input: (props: ComponentProps<"input">) => <input {...props} /> }));
vi.mock("./ExtensionInstallDialog", () => ({ ExtensionInstallDialog: () => null }));
vi.mock("./ExtensionSourceDialog", () => ({ ExtensionSourceDialog: () => null }));

import { ExtensionStore } from "./ExtensionStore";

it("shows skill suggestions immediately and restores them after clearing a search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <ExtensionStore environmentId={EnvironmentId.make("store-env")} initialKind="skill" />,
      );
    });
    const titles = () =>
      renderer!.root
        .findAllByType("h3")
        .map((heading) => heading.findByType("button").children.join(""));
    expect(titles()).toEqual(["suggested-skill"]);
    await act(() =>
      renderer!.root.findByType("input").props.onChange({ currentTarget: { value: "testing" } }),
    );
    expect(titles()).toEqual(["testing"]);
    await act(() =>
      renderer!.root.findByType("input").props.onChange({ currentTarget: { value: "" } }),
    );
    expect(titles()).toEqual(["suggested-skill"]);
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
