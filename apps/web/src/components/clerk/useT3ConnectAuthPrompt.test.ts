import { describe, expect, it } from "vite-plus/test";

import { openT3ConnectAuthPrompt } from "./useT3ConnectAuthPrompt";

describe("openT3ConnectAuthPrompt", () => {
  it("opens Clerk with both web return URLs", () => {
    const calls: Array<unknown> = [];

    openT3ConnectAuthPrompt(
      {
        openSignIn: (props) => {
          calls.push(props);
        },
      },
      "https://app.t3.codes/connect?state=state-1",
      false,
    );

    expect(calls).toEqual([
      {
        forceRedirectUrl: "https://app.t3.codes/connect?state=state-1",
        signUpForceRedirectUrl: "https://app.t3.codes/connect?state=state-1",
      },
    ]);
  });
});
