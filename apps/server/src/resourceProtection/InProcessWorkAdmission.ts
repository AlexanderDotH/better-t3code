import type { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export const MEBIBYTE = 1024 ** 2;
export const IN_PROCESS_BASE_RESERVATION_BYTES = 64 * MEBIBYTE;
export const MAX_IN_PROCESS_TURNS_PER_PROVIDER_INSTANCE = 40;

export interface InProcessWorkReservation {
  readonly serializedHistoryBytes: number;
  readonly attachmentBytes: number;
  readonly toolBufferBytes: number;
}

export interface InProcessCriticalPressureNotice {
  readonly reason: "critical-memory-pressure";
  readonly workId: string;
  readonly reservedBytes: number;
  readonly sampledAtMs: number;
  readonly availableMemoryBytes: number;
  readonly coreReserveBytes: number;
}

export interface InProcessWorkAdmissionRequest {
  readonly workId: string;
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly reservation: InProcessWorkReservation;
  readonly onCriticalPressure: (notice: InProcessCriticalPressureNotice) => Effect.Effect<void>;
}

export interface InProcessWorkLease {
  readonly workId: string;
  readonly reservedBytes: number;
  readonly release: Effect.Effect<void>;
}

export interface ProviderInProcessUsage {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly reservedBytes: number;
}

export interface InProcessUsage {
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly reservedBytes: number;
  readonly providers: ReadonlyArray<ProviderInProcessUsage>;
}

function byteCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value));
}

function saturatedAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

export function inProcessReservationBytes(reservation: InProcessWorkReservation): number {
  const historyBytes = byteCount(reservation.serializedHistoryBytes);
  const attachmentBytes = byteCount(reservation.attachmentBytes);
  const toolBufferBytes = byteCount(reservation.toolBufferBytes);
  return saturatedAdd(
    saturatedAdd(
      saturatedAdd(
        IN_PROCESS_BASE_RESERVATION_BYTES,
        Math.min(Number.MAX_SAFE_INTEGER, 2 * historyBytes),
      ),
      attachmentBytes,
    ),
    toolBufferBytes,
  );
}
