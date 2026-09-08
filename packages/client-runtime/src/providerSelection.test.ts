import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { isStartedThreadModelChangeAllowed } from "./providerSelection";

const instanceId = ProviderInstanceId.make("codex-work");
const otherInstanceId = ProviderInstanceId.make("codex-personal");
const currentSelection = { instanceId, model: "model-a" };
const input = {
  hasStarted: true,
  allowMidChatProviderSwitching: false,
  currentSelection,
  nextSelection: { instanceId, model: "model-b" },
  currentRequiresNewThread: true,
  nextRequiresNewThread: false,
};
describe("started thread model selection", () => {
  it("restricts either provider's model changes without the capability", () => {
    expect(isStartedThreadModelChangeAllowed(input)).toBe(false);
    expect(
      isStartedThreadModelChangeAllowed({
        ...input,
        currentRequiresNewThread: false,
        nextRequiresNewThread: true,
      }),
    ).toBe(false);
    expect(isStartedThreadModelChangeAllowed({ ...input, currentRequiresNewThread: false })).toBe(
      true,
    );
  });
  it("allows fresh threads and environments with mid-chat switching", () => {
    expect(isStartedThreadModelChangeAllowed({ ...input, hasStarted: false })).toBe(true);
    expect(
      isStartedThreadModelChangeAllowed({ ...input, allowMidChatProviderSwitching: true }),
    ).toBe(true);
  });
  it("keeps the current model selectable and compares the actual session instance", () => {
    expect(isStartedThreadModelChangeAllowed({ ...input, nextSelection: currentSelection })).toBe(
      true,
    );
    expect(
      isStartedThreadModelChangeAllowed({
        ...input,
        nextSelection: currentSelection,
        currentProviderInstanceId: otherInstanceId,
      }),
    ).toBe(false);
    expect(
      isStartedThreadModelChangeAllowed({
        ...input,
        nextSelection: { ...currentSelection, instanceId: otherInstanceId },
        currentProviderInstanceId: otherInstanceId,
      }),
    ).toBe(true);
  });
});
