import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthFilesystemReadScope, WS_METHODS, type ProjectContentMatch } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { FlatList, Modal, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { connectionAtomRuntime } from "../../connection/runtime";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { appAtomRegistry } from "../../state/atom-registry";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { SourceFileSurface } from "../files/SourceFileSurface";
import { buildProjectContentSearchQuery } from "./projectContentSearch";

type SearchTarget = { readonly project: EnvironmentProject | null; readonly cwd?: string };
const searchTargetAtom = Atom.make<SearchTarget | null>(null);
const searchContents = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile:project-content-search",
  tag: WS_METHODS.projectsSearchContents,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

export function requestProjectContentSearch(project?: EnvironmentProject, cwd?: string) {
  appAtomRegistry.set(searchTargetAtom, { project: project ?? null, ...(cwd ? { cwd } : {}) });
}

export function ProjectContentSearchOverlay() {
  const target = useAtomValue(searchTargetAtom);
  return target ? (
    <ProjectContentSearchSheet
      target={target}
      onClose={() => appAtomRegistry.set(searchTargetAtom, null)}
    />
  ) : null;
}

function ProjectContentSearchSheet(props: {
  readonly target: SearchTarget;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const projects = useProjects().filter((project) => project.archivedAt == null);
  const [target, setTarget] = useState(props.target);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [file, setFile] = useState<ProjectContentMatch | null>(null);
  const environmentId = target.project?.environmentId ?? null;
  const cwd = target.cwd ?? target.project?.workspaceRoot ?? "";
  const canRead = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const debouncedQuery = useDebouncedValue(query, 200);
  const input = buildProjectContentSearchQuery({
    cwd,
    query: debouncedQuery,
    caseSensitive,
    wholeWord,
    useRegex,
  });
  const search = useEnvironmentQuery(
    canRead && environmentId !== null && input ? searchContents({ environmentId, input }) : null,
  );
  const contents = useEnvironmentQuery(
    canRead && environmentId !== null && file
      ? projectEnvironment.readFile({ environmentId, input: { cwd, relativePath: file.path } })
      : null,
  );
  const pending = query !== debouncedQuery || search.isPending;
  const error =
    search.error ??
    (search.data?.regexFallbackError
      ? translator.message("mobile.home.search.invalidRegex")
      : query.length > 256
        ? translator.message("mobile.home.search.tooLong")
        : null);
  const switches = [
    {
      key: "regex",
      label: translator.message("mobile.home.search.regex"),
      short: ".*",
      active: useRegex,
      toggle: () => setUseRegex(!useRegex),
    },
    {
      key: "case",
      label: translator.message("mobile.home.search.case"),
      short: "Aa",
      active: caseSensitive,
      toggle: () => setCaseSensitive(!caseSensitive),
    },
    {
      key: "word",
      label: translator.message("mobile.home.search.word"),
      short: "ab",
      active: wholeWord,
      toggle: () => setWholeWord(!wholeWord),
    },
  ];
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View
        className="flex-1 bg-screen"
        style={{
          paddingTop: Platform.OS === "android" ? insets.top : 0,
          paddingBottom: insets.bottom,
        }}
      >
        <SheetHeader
          presentation="inline"
          title={translator.message("mobile.home.searchContents")}
          onClose={props.onClose}
        />
        {file ? (
          <>
            <View className="flex-row items-center gap-3 px-4 py-2">
              <Button
                tone="text"
                icon="chevron.left"
                label={translator.message("mobile.archive.searchShort")}
                onPress={() => setFile(null)}
              />
              <AppText className="min-w-0 flex-1 text-sm" numberOfLines={2}>
                {file.path}:{file.lineNumber}
              </AppText>
            </View>
            {!canRead ? (
              <AppText className="px-4 text-foreground-muted">
                {translator.message("mobile.home.search.noPermission")}
              </AppText>
            ) : contents.data ? (
              <SourceFileSurface
                contents={contents.data.contents}
                path={file.path}
                initialLine={file.lineNumber}
                onRefresh={contents.refresh}
              />
            ) : contents.error ? (
              <AppText className="px-4 text-danger">{contents.error}</AppText>
            ) : (
              <AppActivityIndicator />
            )}
          </>
        ) : (
          <>
            <View className="gap-3 px-4 py-2">
              <Menu
                actions={projects.map((project) => ({
                  id: scopedProjectKey(project.environmentId, project.id),
                  title: project.title,
                  subtitle: project.workspaceRoot,
                }))}
                onPressAction={({ nativeEvent }) => {
                  const project = projects.find(
                    (candidate) =>
                      scopedProjectKey(candidate.environmentId, candidate.id) === nativeEvent.event,
                  );
                  if (project) setTarget({ project });
                }}
              >
                <View accessible accessibilityRole="button" className="min-h-11 justify-center">
                  <AppText className="font-t3-semibold">
                    {target.project?.title ?? translator.message("mobile.navigation.project")}
                  </AppText>
                </View>
              </Menu>
              <TextInput
                accessibilityLabel={translator.message("mobile.home.searchContents")}
                placeholder={translator.message("mobile.archive.searchShort")}
                placeholderTextColorClassName="accent-placeholder"
                className="min-h-12 rounded-xl bg-subtle px-3 text-base text-foreground"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={257}
              />
              <View className="flex-row gap-3">
                {switches.map((option) => (
                  <Pressable
                    key={option.key}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: option.active }}
                    accessibilityLabel={option.label}
                    onPress={option.toggle}
                    className={
                      option.active
                        ? "min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary"
                        : "min-h-11 min-w-11 items-center justify-center rounded-xl bg-subtle"
                    }
                  >
                    <AppText
                      className={option.active ? "text-primary-foreground" : "text-foreground"}
                    >
                      {option.short}
                    </AppText>
                  </Pressable>
                ))}
              </View>
              {!canRead && target.project ? (
                <AppText className="text-foreground-muted">
                  {translator.message("mobile.home.search.noPermission")}
                </AppText>
              ) : null}
              {pending ? (
                <AppActivityIndicator />
              ) : error ? (
                <AppText className="text-danger">{error}</AppText>
              ) : null}
            </View>
            <FlatList
              data={pending || error ? [] : (search.data?.matches ?? [])}
              keyExtractor={(match) => `${match.path}:${match.lineNumber}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  className="gap-1 border-b border-border-subtle px-4 py-3"
                  onPress={() => {
                    if (
                      environmentId !== null &&
                      readEnvironmentScope(environmentId, AuthFilesystemReadScope)
                    )
                      setFile(item);
                  }}
                >
                  <AppText className="text-sm font-t3-semibold" numberOfLines={1}>
                    {item.path}:{item.lineNumber}
                  </AppText>
                  <AppText className="font-mono text-sm text-foreground-muted" numberOfLines={3}>
                    {item.lineContent}
                  </AppText>
                </Pressable>
              )}
              ListEmptyComponent={
                !pending && !error && query.trim() && target.project ? (
                  <AppText className="p-4 text-foreground-muted">
                    {translator.message("mobile.home.search.noResults")}
                  </AppText>
                ) : undefined
              }
              ListFooterComponent={
                search.data?.truncated ? (
                  <AppText className="p-4 text-foreground-muted">
                    {translator.message("mobile.home.search.more")}
                  </AppText>
                ) : undefined
              }
            />
          </>
        )}
      </View>
    </Modal>
  );
}
