/**
 * Provider-native history discovery and import SPI.
 *
 * This facet is deliberately separate from `ProviderAdapterShape`: live turn
 * execution and read-only history discovery have different capability and
 * lifecycle boundaries. Every materialized provider instance advertises one
 * explicit facet, so orchestration never branches on a driver name.
 */
import type {
  HarnessChatActivity,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type ProviderHistoryActivity = HarnessChatActivity;

export interface ProviderHistorySyncCapabilities {
  readonly search: boolean;
  readonly archived: boolean;
  readonly resume: boolean;
  readonly activity: boolean;
}

export const NO_PROVIDER_HISTORY_SYNC_CAPABILITIES: ProviderHistorySyncCapabilities = {
  search: false,
  archived: false,
  resume: false,
  activity: false,
};

/** Identity shared by instances that read the same provider-native history. */
export interface ProviderHistorySyncSource {
  readonly sourceId: string;
  readonly continuationKey: string;
  readonly displayName: string;
  readonly capabilities: ProviderHistorySyncCapabilities;
}

export interface ProviderHistoryThreadSummary {
  readonly sessionId: string;
  readonly title: string | null;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly createdAt?: string | undefined;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly isChild: boolean;
  readonly messageCount?: number | undefined;
  readonly activity: ProviderHistoryActivity;
}

export interface ProviderHistoryListInput {
  readonly query?: string | undefined;
  readonly cwd?: string | undefined;
  readonly includeArchived: boolean;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface ProviderHistoryListResult {
  readonly items: ReadonlyArray<ProviderHistoryThreadSummary>;
  readonly nextCursor?: string | undefined;
  /** Native total when the harness exposes one. The sync service may enumerate otherwise. */
  readonly totalMatching?: number | undefined;
  /** Native latest timestamp when the harness exposes one. */
  readonly latestUpdatedAt?: string | undefined;
}

export type ProviderHistoryAttachmentContent =
  | { readonly type: "data-url"; readonly dataUrl: string }
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "url"; readonly url: string };

export interface ProviderHistoryAttachment {
  readonly type: "image" | "audio";
  readonly nativeAttachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly content: ProviderHistoryAttachmentContent;
}

export interface ProviderHistoryMessage {
  readonly kind: "message";
  readonly nativeMessageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments: ReadonlyArray<ProviderHistoryAttachment>;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface ProviderHistoryPlan {
  readonly kind: "plan";
  readonly nativePlanId: string;
  readonly markdown: string;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export type ProviderHistoryTranscriptItem = ProviderHistoryMessage | ProviderHistoryPlan;

export interface ProviderHistoryTranscript {
  readonly sessionId: string;
  readonly items: ReadonlyArray<ProviderHistoryTranscriptItem>;
  readonly cwd?: string | undefined;
  readonly model?: string | undefined;
  readonly updatedAt: string;
}

export interface ProviderHistoryResumeBinding {
  /** Opaque JSON-like value consumed only by the owning live provider adapter. */
  readonly resumeCursor: unknown;
  readonly runtimePayload?: unknown;
  readonly adapterKey?: string | undefined;
}

export class ProviderHistorySyncError extends Schema.TaggedErrorClass<ProviderHistorySyncError>()(
  "ProviderHistorySyncError",
  {
    sourceId: Schema.String,
    operation: Schema.String,
    sessionId: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const session = this.sessionId === undefined ? "" : ` for session '${this.sessionId}'`;
    return `Provider history sync failed for '${this.sourceId}'${session} during ${this.operation}: ${this.detail}`;
  }
}

export interface ProviderHistorySyncAdapter {
  readonly list: (
    input: ProviderHistoryListInput,
  ) => Effect.Effect<ProviderHistoryListResult, ProviderHistorySyncError>;
  readonly read: (input: {
    readonly sessionId: string;
  }) => Effect.Effect<ProviderHistoryTranscript, ProviderHistorySyncError>;
  readonly resumeCursor: (input: {
    readonly sessionId: string;
  }) => Effect.Effect<ProviderHistoryResumeBinding, ProviderHistorySyncError>;
  readonly checkActivity?:
    | ((input: {
        readonly sessionId: string;
      }) => Effect.Effect<ProviderHistoryActivity, ProviderHistorySyncError>)
    | undefined;
}

export type ProviderHistorySyncFacet =
  | {
      readonly availability: "supported";
      readonly source: ProviderHistorySyncSource;
      readonly adapter: ProviderHistorySyncAdapter;
    }
  | {
      readonly availability: "unsupported";
      readonly source: ProviderHistorySyncSource;
      readonly reason: string;
    }
  | {
      readonly availability: "already-local";
      readonly source: ProviderHistorySyncSource;
      readonly reason: string;
    };

export function makeSupportedProviderHistorySync(input: {
  readonly source: ProviderHistorySyncSource;
  readonly adapter: ProviderHistorySyncAdapter;
}): ProviderHistorySyncFacet {
  return { availability: "supported", source: input.source, adapter: input.adapter };
}

export function makeUnsupportedProviderHistorySync(input: {
  readonly source: ProviderHistorySyncSource;
  readonly reason: string;
}): ProviderHistorySyncFacet {
  return { availability: "unsupported", source: input.source, reason: input.reason };
}

export function makeAlreadyLocalProviderHistorySync(input: {
  readonly source: ProviderHistorySyncSource;
  readonly reason: string;
}): ProviderHistorySyncFacet {
  return { availability: "already-local", source: input.source, reason: input.reason };
}

export function makeProviderHistorySyncSource(input: {
  readonly sourceId: string;
  readonly continuationKey: string;
  readonly displayName: string;
  readonly capabilities: ProviderHistorySyncCapabilities;
}): ProviderHistorySyncSource {
  return input;
}

export function makeInstanceHistorySyncSource(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly continuationKey: string;
  readonly displayName: string;
  readonly capabilities: ProviderHistorySyncCapabilities;
}): ProviderHistorySyncSource {
  return makeProviderHistorySyncSource({
    // Instances that resolve the same native history must keep one public
    // source identity even when an instance is renamed or removed.
    sourceId: `${input.driverKind}:history:${input.continuationKey}`,
    continuationKey: input.continuationKey,
    displayName: input.displayName,
    capabilities: input.capabilities,
  });
}
