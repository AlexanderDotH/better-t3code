import * as Schema from "effect/Schema";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type {
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
} from "./planParallelismReview.ts";
import type {
  HarnessChatSyncListInput,
  HarnessChatSyncListResult,
  HarnessChatSyncRunInput,
  HarnessChatSyncRunResult,
  HarnessChatSyncSourcesInput,
  HarnessChatSyncSourcesResult,
  HarnessChatSyncStatusInput,
  HarnessChatSyncStatusResult,
} from "./harnessChatSync.ts";
import { DesktopEnvironmentBootstrapSchema, type EnvironmentApi } from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("EnvironmentApi plan reviews", () => {
  it("exposes the typed plan parallelism review operation", () => {
    expectTypeOf<EnvironmentApi["plan"]["reviewParallelism"]>().toEqualTypeOf<
      (input: PlanParallelismReviewInput) => Promise<PlanParallelismReviewResult>
    >();
  });
});

describe("EnvironmentApi harness chat sync", () => {
  it("exposes every environment-scoped sync operation", () => {
    expectTypeOf<EnvironmentApi["harnessChatSync"]["sources"]>().toEqualTypeOf<
      (input?: HarnessChatSyncSourcesInput) => Promise<HarnessChatSyncSourcesResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["list"]>().toEqualTypeOf<
      (input: HarnessChatSyncListInput) => Promise<HarnessChatSyncListResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["run"]>().toEqualTypeOf<
      (input: HarnessChatSyncRunInput) => Promise<HarnessChatSyncRunResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["status"]>().toEqualTypeOf<
      (input: HarnessChatSyncStatusInput) => Promise<HarnessChatSyncStatusResult>
    >();
  });
});
