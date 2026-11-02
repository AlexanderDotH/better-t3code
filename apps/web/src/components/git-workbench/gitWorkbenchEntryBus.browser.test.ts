import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import {
  requestGitWorkbenchEntry,
  subscribeGitWorkbenchEntry,
  type GitWorkbenchEntryRequest,
} from "./gitWorkbenchEntryBus";

const environmentId = EnvironmentId.make("environment-1");
const request = { cwd: "/repo", environmentId };
it("reports an unavailable entry so callers can fall back", () => {
  expect(requestGitWorkbenchEntry(request)).toBe(false);
});

it("stops at the first accepting workbench and removes listeners on cleanup", () => {
  const unavailable = vi.fn(() => false);
  const accepted = vi.fn(() => true);
  const duplicate = vi.fn(() => true);
  using _unavailable = { [Symbol.dispose]: subscribeGitWorkbenchEntry(unavailable) };
  const unsubscribe = subscribeGitWorkbenchEntry(accepted);
  using _accepted = { [Symbol.dispose]: unsubscribe };
  using _duplicate = { [Symbol.dispose]: subscribeGitWorkbenchEntry(duplicate) };

  expect(requestGitWorkbenchEntry(request)).toBe(true);
  expect(unavailable).toHaveBeenCalledOnce();
  expect(accepted).toHaveBeenCalledOnce();
  expect(duplicate).not.toHaveBeenCalled();
  unsubscribe();

  expect(requestGitWorkbenchEntry(request)).toBe(true);
  expect(accepted).toHaveBeenCalledOnce();
  expect(duplicate).toHaveBeenCalledOnce();
});

it("captures the initiating focus target with the commit preparation request", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  using _trigger = { [Symbol.dispose]: () => trigger.remove() };
  trigger.focus();
  const received: GitWorkbenchEntryRequest[] = [];
  using _subscription = {
    [Symbol.dispose]: subscribeGitWorkbenchEntry((entry) => {
      received.push(entry);
      return true;
    }),
  };

  expect(requestGitWorkbenchEntry({ ...request, focusCommit: true })).toBe(true);
  expect(received).toEqual([{ ...request, focusCommit: true, returnFocusTarget: trigger }]);
});
