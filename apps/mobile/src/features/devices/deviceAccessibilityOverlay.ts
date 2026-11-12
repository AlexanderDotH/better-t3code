import { withDeviceHubQuery } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { DeviceStreamConfiguration } from "./device-stream-document";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const coordinate = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function createDeviceAccessibilityOverlay(
  configuration: DeviceStreamConfiguration,
  frame: HTMLElement,
  onError: () => void,
) {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  frame.append(overlay);
  let controller: AbortController | null = null;
  const setEnabled = async (enabled: boolean) => {
    controller?.abort();
    overlay.replaceChildren();
    if (!enabled) return;
    const request = new AbortController();
    controller = request;
    try {
      const ios = configuration.platform === "ios";
      const vendor = ios ? "serve-sim" : "serve-emu";
      const path = ios
        ? `/helper/${encodeURIComponent(configuration.deviceId)}/ax`
        : `/api/accessibility?device=${encodeURIComponent(configuration.deviceId)}`;
      const response = await fetch(
        withDeviceHubQuery(
          `${configuration.access.httpBase}/vendor/${vendor}${path}`,
          configuration.access,
        ),
        {
          credentials: configuration.access.credentials ? "include" : "omit",
          signal: request.signal,
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload: unknown = await response.json();
      let count = 0;
      const add = (
        x: number,
        y: number,
        width: number,
        height: number,
        screenWidth: number,
        screenHeight: number,
        label: unknown,
      ) => {
        if (width <= 0 || height <= 0 || screenWidth <= 0 || screenHeight <= 0 || count >= 500)
          return;
        count++;
        const box = document.createElement("div");
        Object.assign(box.style, {
          position: "absolute",
          left: `${(100 * x) / screenWidth}%`,
          top: `${(100 * y) / screenHeight}%`,
          width: `${(100 * width) / screenWidth}%`,
          height: `${(100 * height) / screenHeight}%`,
          border: "1px solid #3b82f6",
          boxSizing: "border-box",
        });
        box.title = typeof label === "string" ? label : "";
        overlay.append(box);
      };
      if (ios && Array.isArray(payload)) {
        const root: unknown = payload[0];
        const bounds = record(root) && record(root.frame) ? root.frame : null;
        const visit = (node: unknown) => {
          if (!record(node) || count >= 500) return;
          if (record(node.frame))
            add(
              coordinate(node.frame.x),
              coordinate(node.frame.y),
              coordinate(node.frame.width),
              coordinate(node.frame.height),
              coordinate(bounds?.width),
              coordinate(bounds?.height),
              node.AXLabel,
            );
          if (Array.isArray(node.children)) node.children.forEach(visit);
        };
        payload.forEach(visit);
      } else if (!ios && record(payload) && Array.isArray(payload.nodes)) {
        const root: unknown = payload.nodes[0];
        const bounds = record(root) && record(root.bounds) ? root.bounds : null;
        for (const node of payload.nodes) {
          if (!record(node) || !record(node.bounds)) continue;
          add(
            coordinate(node.bounds.left),
            coordinate(node.bounds.top),
            coordinate(node.bounds.right) - coordinate(node.bounds.left),
            coordinate(node.bounds.bottom) - coordinate(node.bounds.top),
            coordinate(bounds?.right),
            coordinate(bounds?.bottom),
            node.text ?? node.contentDescription,
          );
        }
      } else throw new Error("Unexpected accessibility response");
    } catch {
      if (!request.signal.aborted) onError();
    }
  };
  return {
    setEnabled,
    dispose: () => {
      controller?.abort();
      overlay.remove();
    },
  };
}
