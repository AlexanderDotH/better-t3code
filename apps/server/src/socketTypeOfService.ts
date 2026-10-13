// @effect-diagnostics nodeBuiltinImport:off - compatibility with Node's socket boundary.
import * as NodeNet from "node:net";

interface SocketTypeOfService {
  setTypeOfService?: (typeOfService: number) => unknown;
}

// Bundled Undici calls this outside the fetch promise's error boundary.
// On macOS, a best-effort QoS update can throw EINVAL and kill the server.
export function installSocketTypeOfServiceCompatibility(
  platform: NodeJS.Platform,
  prototype: SocketTypeOfService = NodeNet.Socket.prototype as NodeNet.Socket & SocketTypeOfService,
) {
  const setTypeOfService = prototype.setTypeOfService;
  if (platform !== "darwin" || !setTypeOfService) return;

  prototype.setTypeOfService = function (typeOfService) {
    try {
      return setTypeOfService.call(this, typeOfService);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EINVAL" &&
        "syscall" in error &&
        error.syscall === "setTypeOfService"
      ) {
        return this;
      }
      throw error;
    }
  };
}
