// @effect-diagnostics nodeBuiltinImport:off - exercises Node's HTTP socket boundary.
// @effect-diagnostics globalFetch:off - regression requires Node's bundled Undici fetch.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import { describe, expect, it, vi } from "vite-plus/test";

import { installSocketTypeOfServiceCompatibility } from "./socketTypeOfService.ts";

const qosError = () =>
  Object.assign(new Error("setTypeOfService EINVAL"), {
    code: "EINVAL",
    syscall: "setTypeOfService",
  });

describe("socket type of service compatibility", () => {
  it("allows a real HTTP response despite macOS QoS failure", async () => {
    const server = NodeHttp.createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");

    const prototype = NodeNet.Socket.prototype as NodeNet.Socket & {
      setTypeOfService: (value: number) => NodeNet.Socket;
    };
    const setTypeOfService = vi.spyOn(prototype, "setTypeOfService").mockImplementation(() => {
      throw qosError();
    });
    installSocketTypeOfServiceCompatibility("darwin", prototype);
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(await response.text()).toBe("ok");
      expect(setTypeOfService).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves the receiver, arguments, and successful return value", () => {
    const prototype = {
      value: 0,
      setTypeOfService(value: number) {
        this.value = value;
        return this;
      },
    };
    installSocketTypeOfServiceCompatibility("darwin", prototype);
    expect(prototype.setTypeOfService(32)).toBe(prototype);
    expect(prototype.value).toBe(32);
  });

  it.each([
    new TypeError("invalid priority"),
    Object.assign(new Error("other socket failure"), { code: "EIO", syscall: "setTypeOfService" }),
    Object.assign(new Error("unrelated EINVAL"), { code: "EINVAL", syscall: "write" }),
  ])("propagates unrelated errors: %s", (error) => {
    const prototype = {
      setTypeOfService: (_value: number) => {
        throw error;
      },
    };
    installSocketTypeOfServiceCompatibility("darwin", prototype);
    expect(() => prototype.setTypeOfService(0)).toThrow(error);
  });

  it("leaves other platforms and runtimes without QoS support alone", () => {
    const original = vi.fn();
    const prototype = { setTypeOfService: original };
    installSocketTypeOfServiceCompatibility("linux", prototype);
    expect(prototype.setTypeOfService).toBe(original);
    expect(() => installSocketTypeOfServiceCompatibility("darwin", {})).not.toThrow();
  });
});
