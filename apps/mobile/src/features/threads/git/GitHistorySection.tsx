import { LegendList } from "@legendapp/list/react-native";
import type {
  EnvironmentId,
  GitHistoryItem,
  GitHistoryListInput,
  GitHistoryListResult,
  ThreadId,
} from "@t3tools/contracts";
import { useContext, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { Pressable, View } from "react-native";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { gitWorkbenchEnvironment } from "../../../state/git-workbench";
import { useEnvironmentQuery } from "../../../state/query";
import { historyPageInput } from "./git-workbench-model";
import { WorkbenchButton, WorkbenchCard, WorkbenchInput } from "./WorkbenchControls";
import { SourceFileSurface } from "../../files/SourceFileSurface";
import { useWorkbenchFileNavigation } from "./use-workbench-file-navigation";

export function GitHistorySection(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadId?: ThreadId;
}) {
  const t = useMobileInterfaceTranslator();
  const [refName, setRefName] = useState("");
  const [path, setPath] = useState("");
  const [filters, setFilters] = useState({ refName: "", path: "", generation: 0 });
  const registry = useContext(RegistryContext);
  return (
    <WorkbenchCard title={t.message("mobile.git.recentHistory")}>
      <WorkbenchInput
        label={t.message("git.history.branchFilter")}
        value={refName}
        onChangeText={setRefName}
      />
      <WorkbenchInput
        label={t.message("git.history.pathFilter")}
        value={path}
        onChangeText={setPath}
      />
      <View className="flex-row flex-wrap gap-2">
        <WorkbenchButton
          label={t.message("mobile.gitParity.applyFilters")}
          onPress={() => setFilters({ refName, path, generation: filters.generation + 1 })}
        />
        <WorkbenchButton
          label={t.message("mobile.gitParity.refreshHistory")}
          onPress={() => {
            registry.refresh(
              gitWorkbenchEnvironment.history({
                environmentId: props.environmentId,
                input: historyPageInput(props.cwd, filters, null)!,
              }),
            );
            setFilters({ ...filters, generation: filters.generation + 1 });
          }}
        />
      </View>
      <GitHistoryResults
        key={JSON.stringify([props.environmentId, props.cwd, filters])}
        {...props}
        filters={filters}
      />
    </WorkbenchCard>
  );
}

function GitHistoryResults(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadId?: ThreadId;
  readonly filters: { readonly refName: string; readonly path: string };
}) {
  const t = useMobileInterfaceTranslator();
  const [request, setRequest] = useState<GitHistoryListInput>(() =>
    historyPageInput(props.cwd, props.filters, null)!,
  );
  const page = useEnvironmentQuery(
    gitWorkbenchEnvironment.history({ environmentId: props.environmentId, input: request }),
  );
  const [loaded, setLoaded] = useState<{
    readonly page: GitHistoryListResult | null;
    readonly items: ReadonlyArray<GitHistoryItem>;
  }>({ page: null, items: [] });
  if (
    page.data &&
    page.data !== loaded.page &&
    (request.cursor === 0 || page.data.snapshotOid === request.snapshotOid)
  ) {
    const known = new Set(loaded.items.map((item) => item.oid));
    setLoaded({
      page: page.data,
      items:
        request.cursor === 0
          ? page.data.items
          : [...loaded.items, ...page.data.items.filter((item) => !known.has(item.oid))],
    });
  }
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const next = loaded.page ? historyPageInput(props.cwd, props.filters, loaded.page) : null;
  return (
    <View className="gap-2">
      {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- The outer sheet owns header scrolling; this list only scrolls commits. */}
      <LegendList
        recycleItems={false}
        data={loaded.items}
        keyExtractor={(commit) => commit.oid}
        estimatedItemSize={68}
        nestedScrollEnabled
        style={{ height: Math.min(500, Math.max(80, loaded.items.length * 68)) }}
        renderItem={({ item: commit }) => (
          <Pressable
            accessibilityRole="button"
            key={commit.oid}
            onPress={() => setSelectedOid(selectedOid === commit.oid ? null : commit.oid)}
            className="gap-1 border-t border-border-subtle py-3"
          >
            <AppText className="text-sm font-t3-medium text-foreground">{commit.subject}</AppText>
            <AppText className="text-xs text-foreground-muted">
              {commit.shortOid} · {commit.authorName} · {t.date(new Date(commit.authoredAt))}
            </AppText>
            {commit.decorations.length ? (
              <AppText className="text-xs text-foreground-muted">
                {commit.decorations.join(" · ")}
              </AppText>
            ) : null}
          </Pressable>
        )}
      />
      {page.isPending ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.git.loadingHistory")}
        </AppText>
      ) : null}
      {page.error ? <AppText className="text-sm text-red-500">{page.error}</AppText> : null}
      {next ? (
        <WorkbenchButton
          disabled={page.isPending}
          label={t.message("mobile.gitParity.loadMore")}
          onPress={() => setRequest(next)}
        />
      ) : null}
      {selectedOid ? <GitCommitDetails {...props} oid={selectedOid} /> : null}
    </View>
  );
}

function GitCommitDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly oid: string;
  readonly threadId?: ThreadId;
}) {
  const openFile = useWorkbenchFileNavigation(props);
  const detail = useEnvironmentQuery(
    gitWorkbenchEnvironment.commitDetail({
      environmentId: props.environmentId,
      input: { cwd: props.cwd, oid: props.oid },
    }),
  );
  const [path, setPath] = useState<string | null>(null);
  const file = detail.data?.files.find((candidate) => candidate.path === path);
  const patch = useEnvironmentQuery(
    file
      ? gitWorkbenchEnvironment.commitFileDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            oid: props.oid,
            path: file.path,
            ...(file.oldPath ? { oldPath: file.oldPath } : {}),
          },
        })
      : null,
  );
  const t = useMobileInterfaceTranslator();
  return (
    <View className="gap-3 rounded-xl border border-border p-3">
      <AppText selectable className="font-mono text-xs text-foreground-muted">
        {props.oid}
      </AppText>
      {detail.data ? (
        <>
          <AppText className="text-base font-t3-semibold text-foreground">
            {detail.data.subject}
          </AppText>
          <AppText className="text-xs text-foreground-muted">
            {t.message("git.history.author")} {detail.data.authorName} ·{" "}
            {t.date(new Date(detail.data.authoredAt))}
          </AppText>
          <AppText className="text-xs text-foreground-muted">
            {t.message("git.history.committer")} {detail.data.committerName} ·{" "}
            {t.date(new Date(detail.data.committedAt))}
          </AppText>
        </>
      ) : null}
      <AppText className="text-sm text-foreground">
        {detail.error ?? detail.data?.body ?? t.message("mobile.git.loadingHistory")}
      </AppText>
      {detail.data?.files.map((entry) => (
        <View key={entry.path} className="gap-1">
          <WorkbenchButton
            key={entry.path}
            selected={path === entry.path}
            label={`${entry.status} · ${entry.path} +${entry.additions ?? 0} −${entry.deletions ?? 0}`}
            onPress={() => setPath(entry.path)}
          />
          {entry.status !== "deleted" ? (
            <WorkbenchButton
              label={t.message("git.history.openCurrent")}
              onPress={() => openFile(entry.path)}
            />
          ) : null}
        </View>
      ))}
      {patch.error ? <AppText className="text-red-500">{patch.error}</AppText> : null}
      {file?.binary ? (
        <AppText>{t.message("mobile.git.binaryFile")}</AppText>
      ) : patch.data ? (
        <View style={{ height: 480 }}>
          <SourceFileSurface
            embedded
            path={`${file?.path ?? "commit"}.diff`}
            contents={patch.data.patch}
          />
        </View>
      ) : null}
      {detail.data?.truncated || patch.data?.truncated ? (
        <AppText className="text-xs text-amber-600">{t.message("git.diff.patchTruncated")}</AppText>
      ) : null}
    </View>
  );
}
