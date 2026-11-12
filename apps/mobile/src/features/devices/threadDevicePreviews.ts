import type { DeviceServiceState, DeviceSummary, ThreadId } from "@t3tools/contracts";

function deviceSelectionKey(device: Pick<DeviceSummary, "hostId" | "id">) {
  return JSON.stringify([device.hostId, device.id]);
}

export function threadDeviceChoices(state: DeviceServiceState | null, threadId: ThreadId) {
  return (state?.devices ?? []).map((device) => ({
    key: deviceSelectionKey(device),
    device,
    host: state?.hosts.find((host) => host.id === device.hostId),
    open:
      state?.sessions.some(
        (session) =>
          session.threadId === threadId &&
          session.hostId === device.hostId &&
          session.deviceId === device.id,
      ) ?? false,
    booting:
      state?.bootingDevices?.some(
        (entry) => entry.hostId === device.hostId && entry.id === device.id,
      ) ?? false,
  }));
}

/** Host identity is part of the selection because Android serials repeat across hosts. */
export function threadDevicePreviews(state: DeviceServiceState | null, threadId: ThreadId) {
  return (state?.sessions ?? [])
    .filter((session) => session.threadId === threadId)
    .map((session) => {
      const device = state?.devices.find(
        (device) => device.hostId === session.hostId && device.id === session.deviceId,
      );
      const host = state?.hosts.find((host) => host.id === session.hostId);
      return {
        key: deviceSelectionKey({ hostId: session.hostId, id: session.deviceId }),
        session,
        name: device?.name ?? (session.platform === "ios" ? "iOS Simulator" : "Android Emulator"),
        description: [device?.version, host?.label].filter(Boolean).join(" · "),
        serveSimOnly: host?.kind === "simlock",
      };
    });
}

export type ThreadDevicePreview = ReturnType<typeof threadDevicePreviews>[number];

export function selectedThreadDevicePreview(
  previews: ReadonlyArray<ThreadDevicePreview>,
  selectedKey: string | null,
) {
  return previews.find((preview) => preview.key === selectedKey) ?? previews[0] ?? null;
}
