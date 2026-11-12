import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { loadBalancingProjects } from "./load-balancing";

const instanceId = ProviderInstanceId.make("codex");
const model = { instanceId, model: "test-model" };
const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");

function project(environmentId: EnvironmentId, repository = "example.test/team/app") {
  return {
    id: ProjectId.make(`${environmentId}-project`),
    environmentId,
    repositoryIdentity: {
      canonicalKey: repository,
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: `https://${repository}.git`,
      },
    },
    archivedAt: null,
  };
}

function config() {
  return {
    settings: DEFAULT_SERVER_SETTINGS,
    providers: [
      {
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        installed: true,
        availability: "available" as const,
        status: "ready" as const,
        auth: { status: "authenticated" as const },
      },
    ],
  };
}

describe("loadBalancingProjects", () => {
  it("routes a shared project to its only automatic target when the current environment is manual only", () => {
    const local = project(mac);
    const remote = project(server);
    const input = {
      selectedProject: local,
      model,
      projects: [local, remote],
      configs: new Map([
        [mac, config()],
        [server, config()],
      ]),
      connectedIds: new Set([mac, server]),
      weights: { [mac]: 0 },
    };
    expect(loadBalancingProjects(input)).toEqual([remote]);
    expect(loadBalancingProjects({ ...input, connectedIds: new Set([mac]) })).toEqual([]);
    expect(loadBalancingProjects({ ...input, projects: [local] })).toEqual([]);
  });

  it("keeps unrelated repositories, archived copies and unusable providers out of automatic routing", () => {
    const local = project(mac);
    const remote = project(server);
    const input = {
      selectedProject: local,
      model,
      projects: [local, remote],
      configs: new Map([
        [mac, config()],
        [server, config()],
      ]),
      connectedIds: new Set([mac, server]),
      weights: {},
    };
    expect(
      loadBalancingProjects({
        ...input,
        projects: [local, project(server, "example.test/team/other")],
      }),
    ).toEqual([]);
    expect(
      loadBalancingProjects({
        ...input,
        projects: [local, { ...remote, archivedAt: "2026-11-11T00:00:00.000Z" }],
      }),
    ).toEqual([]);
    const unavailable = {
      ...config(),
      providers: [{ ...config().providers[0]!, installed: false }],
    };
    expect(
      loadBalancingProjects({
        ...input,
        configs: new Map([
          [mac, config()],
          [server, unavailable],
        ]),
      }),
    ).toEqual([local]);
    const otherDriver = {
      ...config(),
      providers: [{ ...config().providers[0]!, driver: ProviderDriverKind.make("claude") }],
    };
    expect(
      loadBalancingProjects({
        ...input,
        configs: new Map([
          [mac, config()],
          [server, otherDriver],
        ]),
      }),
    ).toEqual([local]);
  });
});
