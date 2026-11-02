import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { requestGitWorkbenchEntry } from "./gitWorkbenchEntryBus";
const request = { cwd: "/repo", environmentId: EnvironmentId.make("environment-1") };
it("can decline entry without a browser environment", () => {
  expect(requestGitWorkbenchEntry(request)).toBe(false);
});
