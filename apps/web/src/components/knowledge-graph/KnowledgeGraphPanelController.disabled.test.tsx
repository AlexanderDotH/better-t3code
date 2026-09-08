import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const disabledOwnerFixture = vi.hoisted(() => ({
  commands: [] as unknown[],
  atomReads: [] as unknown[],
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => {
    disabledOwnerFixture.atomReads.push(atom);
    throw new Error("Disabled owner must not subscribe to graph state or queries");
  },
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({
    betterT3Environment: {
      version: 1,
      initialization: "clean-install",
      flags: { "knowledge.graph": false },
    },
  }),
}));

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => {
    disabledOwnerFixture.commands.push(command);
    return vi.fn();
  },
}));

import { knowledgeGraphEnvironment } from "../../state/knowledgeGraph";
import { KnowledgeGraphPanelController } from "./KnowledgeGraphPanelController";

describe("KnowledgeGraphPanelController disabled owner", () => {
  beforeEach(() => {
    disabledOwnerFixture.commands.length = 0;
    disabledOwnerFixture.atomReads.length = 0;
  });

  it("mounts no subscriptions or work actions and exposes only confirmed clearing", () => {
    const markup = renderToStaticMarkup(
      <KnowledgeGraphPanelController
        environmentId={EnvironmentId.make("environment-remote")}
        projectId={ProjectId.make("project-1")}
        knowledgeGraphVersion={1}
        onOpenSource={() => undefined}
      />,
    );

    expect(markup).toContain("knowledgeGraph.disabled");
    expect(markup).toContain("knowledgeGraph.clear");
    expect(disabledOwnerFixture.atomReads).toEqual([]);
    expect(disabledOwnerFixture.commands).toEqual([knowledgeGraphEnvironment.clear]);
  });
});
