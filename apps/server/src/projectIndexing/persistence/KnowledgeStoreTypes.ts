import type {
  ProjectIndexCoverageV1,
  ProjectIndexSettings,
  ProjectKnowledgeV1,
  ProjectSourceClassification,
  ProjectSourceFileStatus,
} from "@t3tools/contracts";

export const KNOWLEDGE_RECORD_KINDS = [
  "files",
  "entities",
  "callsites",
  "imports",
  "modules",
  "behaviors",
  "flows",
  "rules",
  "evidence",
  "gaps",
] as const;
export type KnowledgeRecordKind = (typeof KNOWLEDGE_RECORD_KINDS)[number];
export type KnowledgeRecordMap = {
  readonly [Kind in KnowledgeRecordKind]: NonNullable<ProjectKnowledgeV1[Kind]>[number];
};
export type KnowledgeBatch = {
  readonly [Kind in KnowledgeRecordKind]?: ReadonlyArray<KnowledgeRecordMap[Kind]>;
};

export interface WriterLease {
  readonly owner: string;
  readonly token: string;
  readonly expiresAt: number;
}

export type KnowledgeGenerationStatus =
  | "idle"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "cleared";

export interface KnowledgeStoreState {
  readonly workspaceId: string;
  readonly revision: number;
  readonly publishedRevision: number | null;
  readonly activeRevision: number | null;
  readonly status: KnowledgeGenerationStatus;
  readonly settings: ProjectIndexSettings;
  readonly coverage: ProjectIndexCoverageV1 | null;
  readonly updatedAt: number;
}

export interface KnowledgePage<Item> {
  readonly items: ReadonlyArray<Item>;
  readonly nextCursor: string | null;
  readonly revision: number;
}

export const KNOWLEDGE_SEARCH_KINDS = ["files", "entities", "imports", "modules", "rules"] as const;
export type KnowledgeSearchKind = (typeof KNOWLEDGE_SEARCH_KINDS)[number];
export interface KnowledgeSearchPosition {
  readonly rank: number;
  readonly kind: string;
  readonly id: string;
}
export type KnowledgeSearchHit<Kind extends KnowledgeSearchKind> = {
  readonly [RecordKind in Kind]: {
    readonly kind: RecordKind;
    readonly record: KnowledgeRecordMap[RecordKind];
    readonly rank: number;
  };
}[Kind];
export interface KnowledgeSearchQuery<Kind extends KnowledgeSearchKind> {
  readonly revision?: number;
  readonly query: string;
  readonly kinds: ReadonlyArray<Kind>;
  readonly includeStale?: boolean;
  readonly filePathPrefixes?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly after?: KnowledgeSearchPosition;
}
export interface KnowledgeSearchPage<Kind extends KnowledgeSearchKind> {
  readonly revision: number;
  readonly items: ReadonlyArray<KnowledgeSearchHit<Kind>>;
  readonly nextCursor: KnowledgeSearchPosition | null;
}

export interface KnowledgeRecordQuery<Kind extends KnowledgeRecordKind> {
  readonly kind: Kind;
  readonly revision?: number;
  readonly query?: string;
  readonly filePath?: string;
  readonly sourceFilePath?: string;
  readonly filePathPrefixes?: ReadonlyArray<string>;
  readonly entityIds?: ReadonlyArray<string>;
  readonly ids?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly afterId?: string;
  readonly fileStatuses?: ReadonlyArray<ProjectSourceFileStatus>;
  readonly fileClassifications?: ReadonlyArray<ProjectSourceClassification>;
}

export interface KnowledgeCallQuery {
  readonly entityIds: ReadonlyArray<string>;
  readonly direction: "callers" | "callees" | "both";
  readonly revision?: number;
  readonly limit?: number;
  readonly afterId?: string;
}

export type KnowledgeJobKind = "extract" | "semantic" | "review" | "resolve" | "synthesis";
export type KnowledgeJobState = "pending" | "running" | "completed" | "cancelled" | "failed";

export interface KnowledgeJobInput {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: KnowledgeJobKind;
  readonly filePath: string;
  readonly contentHash: string;
  readonly entityId?: string;
  readonly inputJson: string;
}

export interface KnowledgeJob extends KnowledgeJobInput {
  readonly revision: number;
  readonly state: KnowledgeJobState;
  readonly attempts: number;
  readonly detail: string | null;
  readonly claimToken: string | null;
  readonly updatedAt: number;
}

export interface KnowledgeWriteGuard {
  readonly lease: WriterLease;
  readonly revision: number;
}
