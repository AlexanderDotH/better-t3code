import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";

// Import all migrations statically
import Migration0001 from "./001_OrchestrationEvents.ts";
import Migration0002 from "./002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./003_CheckpointDiffBlobs.ts";
import Migration0004 from "./004_ProviderSessionRuntime.ts";
import Migration0005 from "./005_Projections.ts";
import Migration0006 from "./006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./016_CanonicalizeModelSelections.ts";
import Migration0017 from "./017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./020_AuthAccessManagement.ts";
import Migration0021 from "./021_AuthSessionClientMetadata.ts";
import Migration0022 from "./022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./031_AuthAuthorizationScopes.ts";
import Migration0032 from "./032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./033_ProjectionThreadsSettled.ts";
import Migration0034 from "./034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./036_ProjectSpeechProfilesCompatibility.ts";
import Migration0037 from "./037_ProjectionThreadSubagents.ts";
import Migration0038 from "./038_ProjectionThreadsSnoozedCompatibility.ts";
import Migration0039 from "./039_ProjectionThreadSessionAbortState.ts";
import Migration0040 from "./040_ProjectionCompatibility.ts";
import Migration0041 from "./041_ProjectionThreadSubagents.ts";
import Migration0042 from "./042_GitWorkbenchState.ts";
import Migration0043 from "./043_ProjectionThreadSubagentFetchMetadata.ts";
import Migration0044 from "./044_ProjectAgentCoordination.ts";
import Migration0045 from "./045_ForkSchemaConvergence.ts";
import Migration0046 from "./046_ProjectionThreadsPinnedCompatibility.ts";
import Migration0047 from "./047_ProjectionTurnsKeysetIndexCompatibility.ts";
import Migration0048 from "./048_ProjectionThreadsPinOrderKeyCompatibility.ts";
import Migration0049 from "./049_ProjectionProjectsDefaultThreadEnvModeCompatibility.ts";
import Migration0050 from "./050_ProjectionProjectFaviconPathCompatibility.ts";
import Migration0051 from "./051_ProjectionProjectCheckpointsEnabled.ts";
import Migration0052 from "./052_AuthSessionClientConnectionCompatibility.ts";
import Migration0053 from "./053_ProjectionThreadSubagentManagedOrigin.ts";
import Migration0054 from "./054_ProjectionHarnessChatSync.ts";
import Migration0055 from "./055_ProjectionThreadForks.ts";
import Migration0056 from "./056_ProjectionThreadLinkedPullRequest.ts";
import Migration0057 from "./057_ProjectionThreadsUnsettledAt.ts";
import Migration0058 from "./058_Upstream42And43SchemaConvergence.ts";
import Migration0059 from "./059_KnowledgeGraphDerivedData.ts";
import Migration0060 from "./060_ProjectionThreadSubagentServiceTier.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "ProjectSpeechProfilesCompatibility", Migration0036],
  [37, "ProjectionThreadSubagents", Migration0037],
  [38, "ProjectionThreadsSnoozedCompatibility", Migration0038],
  [39, "ProjectionThreadSessionAbortState", Migration0039],
  [40, "ProjectionCompatibility", Migration0040],
  [41, "ProjectionThreadSubagents", Migration0041],
  [42, "GitWorkbenchState", Migration0042],
  [43, "ProjectionThreadSubagentFetchMetadata", Migration0043],
  [44, "ProjectAgentCoordination", Migration0044],
  [45, "ForkSchemaConvergence", Migration0045],
  [46, "ProjectionThreadsPinnedCompatibility", Migration0046],
  [47, "ProjectionTurnsKeysetIndexCompatibility", Migration0047],
  [48, "ProjectionThreadsPinOrderKeyCompatibility", Migration0048],
  [49, "ProjectionProjectsDefaultThreadEnvModeCompatibility", Migration0049],
  [50, "ProjectionProjectFaviconPathCompatibility", Migration0050],
  [51, "ProjectionProjectCheckpointsEnabled", Migration0051],
  [52, "AuthSessionClientConnectionCompatibility", Migration0052],
  [53, "ProjectionThreadSubagentManagedOrigin", Migration0053],
  [54, "ProjectionHarnessChatSync", Migration0054],
  [55, "ProjectionThreadForks", Migration0055],
  [56, "ProjectionThreadLinkedPullRequest", Migration0056],
  [57, "ProjectionThreadsUnsettledAt", Migration0057],
  [58, "Upstream42And43SchemaConvergence", Migration0058],
  [59, "KnowledgeGraphDerivedData", Migration0059],
  [60, "ProjectionThreadSubagentServiceTier", Migration0060],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
