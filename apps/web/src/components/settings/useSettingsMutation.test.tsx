import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useSettingsMutation } from "./useSettingsMutation";

let renderer: ReactTestRenderer | undefined;
let mutation: ReturnType<typeof useSettingsMutation<string, string>>;
const mutationFn = vi.fn<(input: string) => Promise<string>>();
const onSuccess = vi.fn();
const onError = vi.fn();

function Probe() {
  const current = useSettingsMutation({ mutationFn, onSuccess, onError });
  useLayoutEffect(() => {
    mutation = current;
  }, [current]);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  await act(() => {
    renderer = create(<Probe />);
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("does not send duplicate saves while the first request is unresolved", async () => {
  let resolveSave: (value: string) => void = () => {};
  const saved = new Promise<string>((resolve) => {
    resolveSave = resolve;
  });
  mutationFn.mockReturnValueOnce(saved);
  await act(() => {
    mutation.mutate("server-1");
    mutation.mutate("server-1");
  });
  expect(mutationFn).toHaveBeenCalledTimes(1);
  expect(mutation.isPending).toBe(true);
  await act(async () => {
    resolveSave("saved");
    await saved;
  });
  expect(onSuccess).toHaveBeenCalledWith("saved", "server-1");
  expect(mutation.isPending).toBe(false);
});

it("reports a rejected request and permits a corrected retry", async () => {
  const denied = new Error("Environment is read-only");
  mutationFn.mockRejectedValueOnce(denied).mockResolvedValueOnce("saved");
  await act(() => {
    mutation.mutate("server-1");
  });
  expect(onError).toHaveBeenCalledWith(denied, "server-1");
  expect(mutation.isPending).toBe(false);
  await act(() => {
    mutation.mutate("server-2");
  });
  expect(mutationFn).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledWith("saved", "server-2");
  expect(mutation.isPending).toBe(false);
});
