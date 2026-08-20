import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  ProjectSpeechProfile,
  T3ChatImportRunResult,
  T3ChatImportSource,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { agentSettingsEnvironment } from "../../state/agent-settings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import {
  formatChatImportLatest,
  formatChatImportSummary,
  formatCountLabel,
  projectSpeechProfileStatus,
  type SpeechProfileLoadState,
} from "./environment-data-settings";

function failureMessage(result: { readonly _tag: string }, fallback: string): string {
  if (result._tag !== "Failure") return fallback;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : fallback;
}

export function EnvironmentChatImportSettings(props: { readonly environmentId: EnvironmentId }) {
  const discoverSources = useAtomCommand(agentSettingsEnvironment.chatImport.discover, {
    reportFailure: false,
  });
  const importSource = useAtomCommand(agentSettingsEnvironment.chatImport.run, {
    reportFailure: false,
  });
  const [sources, setSources] = useState<ReadonlyArray<T3ChatImportSource> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<T3ChatImportSource["id"] | null>(null);
  const [lastResult, setLastResult] = useState<T3ChatImportRunResult | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError(null);
    const result = await discoverSources({ environmentId: props.environmentId, input: {} });
    if (requestSequence.current !== sequence) return;
    setLoading(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setError(failureMessage(result, "Could not scan for other T3 Code instances."));
      }
      return;
    }
    setSources(result.value.sources);
  }, [discoverSources, props.environmentId]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const runImport = useCallback(
    async (source: T3ChatImportSource) => {
      if (activeSourceId !== null) return;
      setActiveSourceId(source.id);
      setLastResult(null);
      setError(null);
      const result = await importSource({
        environmentId: props.environmentId,
        input: { sourceId: source.id },
      });
      setActiveSourceId(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const message = failureMessage(result, "Could not import chats.");
          setError(message);
          Alert.alert("Could not import chats", message);
        }
        return;
      }
      setLastResult(result.value);
      void reload();
    },
    [activeSourceId, importSource, props.environmentId, reload],
  );

  return (
    <View className="gap-2">
      <SettingsSection title="Import chats">
        {sources === null ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void reload()}
            className="items-center gap-2 p-5"
          >
            {loading ? <ActivityIndicator size="small" /> : null}
            <Text className="text-center text-sm text-foreground-muted">
              {error ?? (loading ? "Looking for other T3 Code instances…" : "Scan for chats")}
            </Text>
          </Pressable>
        ) : sources.length === 0 ? (
          <View className="gap-1 p-5">
            <Text className="text-center text-base font-t3-medium text-foreground">
              No other T3 Code chats found
            </Text>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              The server scans its local .t3 and .t3-* data directories.
            </Text>
          </View>
        ) : (
          sources.map((source, index) => {
            const importing = activeSourceId === source.id;
            return (
              <View
                key={source.id}
                className={index === 0 ? "gap-3 p-4" : "gap-3 border-t border-border-subtle p-4"}
              >
                <View className="gap-1">
                  <Text className="text-base font-t3-medium text-foreground">{source.label}</Text>
                  <Text selectable className="text-xs text-foreground-muted" numberOfLines={2}>
                    {source.databasePath}
                  </Text>
                  <Text className="text-sm text-foreground-muted">
                    {formatCountLabel(source.threadCount, "chat")} ·{" "}
                    {formatChatImportLatest(source.latestUpdatedAt)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: importing, disabled: activeSourceId !== null }}
                  disabled={activeSourceId !== null}
                  onPress={() => void runImport(source)}
                  className="self-start rounded-xl bg-foreground px-4 py-2 disabled:opacity-40"
                >
                  <Text className="font-t3-medium text-background">
                    {importing ? "Importing…" : "Import chats"}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
        {sources !== null ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading || activeSourceId !== null}
            onPress={() => void reload()}
            className="border-t border-border-subtle p-4 disabled:opacity-40"
          >
            <Text className="text-center font-t3-medium text-foreground">
              {loading ? "Scanning…" : "Scan again"}
            </Text>
          </Pressable>
        ) : null}
      </SettingsSection>

      {lastResult ? (
        <Text className="px-2 text-sm leading-normal text-foreground">
          {formatChatImportSummary(lastResult)}
        </Text>
      ) : null}
      {error && sources !== null ? (
        <Text className="px-2 text-sm leading-normal text-danger-foreground">{error}</Text>
      ) : null}
      <Text className="px-2 text-xs leading-normal text-foreground-muted">
        Imported chats receive new local IDs and cannot resume source sessions. Re-importing safely
        syncs the same chats without duplicates.
      </Text>
    </View>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type ProjectSpeechAction = "index" | "basic";

export function EnvironmentSpeechProfileSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const listProfiles = useAtomCommand(serverEnvironment.listProjectSpeechProfiles, {
    reportFailure: false,
  });
  const indexProfile = useAtomCommand(serverEnvironment.indexProjectSpeechProfile, {
    reportFailure: false,
  });
  const createBasicProfile = useAtomCommand(serverEnvironment.createBasicProjectSpeechProfile, {
    reportFailure: false,
  });
  const [profiles, setProfiles] = useState<ReadonlyMap<ProjectId, ProjectSpeechProfile> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<ProjectId>>(() => new Set());
  const [busyActions, setBusyActions] = useState<ReadonlyMap<ProjectId, ProjectSpeechAction>>(
    () => new Map(),
  );
  const requestSequence = useRef(0);
  const chevronColor = useThemeColor("--color-chevron");
  const sortedProjects = useMemo(
    () => [...props.projects].sort((left, right) => left.title.localeCompare(right.title)),
    [props.projects],
  );

  const reload = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setLoadError(null);
    const result = await listProfiles({ environmentId: props.environmentId, input: {} });
    if (requestSequence.current !== sequence) return;
    setLoading(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setLoadError(failureMessage(result, "Could not load project speech profiles."));
      }
      return;
    }
    setProfiles(new Map(result.value.profiles.map((profile) => [profile.projectId, profile])));
  }, [listProfiles, props.environmentId]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const toggleProject = useCallback((projectId: ProjectId) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (project: EnvironmentProject, action: ProjectSpeechAction) => {
      if (busyActions.has(project.id)) return;
      setBusyActions((current) => new Map(current).set(project.id, action));
      const command = action === "index" ? indexProfile : createBasicProfile;
      const result = await command({
        environmentId: props.environmentId,
        input: { projectId: project.id },
      });
      setBusyActions((current) => {
        const next = new Map(current);
        next.delete(project.id);
        return next;
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          Alert.alert(
            action === "index" ? "Could not index project" : "Could not create basic context",
            failureMessage(result, "The project speech profile could not be updated."),
          );
        }
        return;
      }
      setProfiles((current) => {
        const next = new Map<ProjectId, ProjectSpeechProfile>(current ?? []);
        next.set(project.id, result.value);
        return next;
      });
    },
    [busyActions, createBasicProfile, indexProfile, props.environmentId],
  );

  const loadState: SpeechProfileLoadState = loadError
    ? "error"
    : loading || profiles === null
      ? "loading"
      : "ready";

  return (
    <View className="gap-2">
      <SettingsSection title="Project speech context">
        {sortedProjects.length === 0 ? (
          <Text className="p-5 text-center text-sm text-foreground-muted">
            No projects are available in this environment.
          </Text>
        ) : (
          sortedProjects.map((project, index) => {
            const profile = profiles?.get(project.id);
            const status = projectSpeechProfileStatus(profile, loadState);
            const expanded = expandedProjects.has(project.id);
            const busyAction = busyActions.get(project.id);
            const indexLabel = profile?.source === "indexed" ? "Reindex" : "Index";
            return (
              <View
                key={project.id}
                className={index === 0 ? undefined : "border-t border-border-subtle"}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`Toggle ${project.title} speech profile`}
                  onPress={() => toggleProject(project.id)}
                  className="flex-row items-center gap-3 p-4"
                >
                  <View className="min-w-0 flex-1 gap-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text
                        className="shrink text-base font-t3-medium text-foreground"
                        numberOfLines={1}
                      >
                        {project.title}
                      </Text>
                      <Text className="text-xs text-foreground-muted">{status}</Text>
                    </View>
                    <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                      {project.workspaceRoot}
                    </Text>
                  </View>
                  {status === "Loading" ? <ActivityIndicator size="small" /> : null}
                  <SymbolView
                    name={expanded ? "chevron.up" : "chevron.down"}
                    size={13}
                    tintColor={chevronColor}
                    type="monochrome"
                  />
                </Pressable>

                {expanded ? (
                  <View className="gap-3 border-t border-border-subtle px-4 pb-4 pt-3">
                    {profile ? (
                      <>
                        <View className="gap-1">
                          <Text className="text-xs font-t3-medium text-foreground">
                            AssemblyAI prompt
                          </Text>
                          <Text
                            selectable
                            className="text-xs leading-normal text-foreground-muted"
                            numberOfLines={4}
                          >
                            {profile.contextPrompt}
                          </Text>
                        </View>
                        <Text className="text-xs text-foreground-muted">
                          {formatCountLabel(profile.keyterms.length, "keyterm")} ·{" "}
                          {formatCountLabel(
                            profile.technologies.length,
                            "technology",
                            "technologies",
                          )}
                        </Text>
                        {profile.warning ? (
                          <Text className="text-xs leading-normal text-danger-foreground">
                            {profile.warning}
                          </Text>
                        ) : null}
                        <Text className="text-xs text-foreground-muted">
                          Updated {formatUpdatedAt(profile.updatedAt)}
                        </Text>
                      </>
                    ) : loadState === "error" ? (
                      <Text className="text-sm leading-normal text-danger-foreground">
                        {loadError ?? "This speech profile is unavailable."}
                      </Text>
                    ) : loadState === "ready" ? (
                      <Text className="text-sm leading-normal text-foreground-muted">
                        Index this project for repository-aware recognition, or use basic context
                        from project metadata.
                      </Text>
                    ) : (
                      <Text className="text-sm text-foreground-muted">Loading this profile…</Text>
                    )}

                    <View className="flex-row flex-wrap gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          busy: busyAction === "index",
                          disabled: busyAction !== undefined,
                        }}
                        disabled={busyAction !== undefined}
                        onPress={() => void runAction(project, "index")}
                        className="rounded-xl bg-foreground px-4 py-2 disabled:opacity-40"
                      >
                        <Text className="font-t3-medium text-background">
                          {busyAction === "index" ? `${indexLabel}ing…` : indexLabel}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          busy: busyAction === "basic",
                          disabled: busyAction !== undefined || profile?.source === "basic",
                        }}
                        disabled={busyAction !== undefined || profile?.source === "basic"}
                        onPress={() => void runAction(project, "basic")}
                        className="rounded-xl bg-subtle px-4 py-2 disabled:opacity-40"
                      >
                        <Text className="font-t3-medium text-foreground">
                          {busyAction === "basic" ? "Creating…" : "Use basic context"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        <Pressable
          accessibilityRole="button"
          disabled={loading || busyActions.size > 0}
          onPress={() => void reload()}
          className="border-t border-border-subtle p-4 disabled:opacity-40"
        >
          <Text className="text-center font-t3-medium text-foreground">
            {loading ? "Refreshing profiles…" : "Refresh profiles"}
          </Text>
        </Pressable>
      </SettingsSection>
      <Text className="px-2 text-xs leading-normal text-foreground-muted">
        Indexing extracts project terminology and technology names for AssemblyAI. No source
        snippets are sent.
      </Text>
    </View>
  );
}
