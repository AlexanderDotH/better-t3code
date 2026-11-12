import { requestProjectContentSearch } from "../keyboard/ProjectContentSearchSheet";
import { useNavigation } from "@react-navigation/native";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { openSettings } from "../settings/settings-navigation";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import type { GroupedThreadListGroup } from "./homeThreadList";
import { ProjectIndexingIndicator } from "./ProjectIndexingIndicator";

const DOT_COLORS = {
  attention: "bg-warning",
  failed: "bg-danger",
  unread: "bg-success",
  working: "bg-primary",
} as const;
const DOT_LABELS = {
  attention: "mobile.thread.request",
  failed: "sidebar.status.failed",
  unread: "sidebar.status.done",
  working: "mobile.thread.working",
} as const;

function ProjectFolderHeader(props: {
  readonly group: GroupedThreadListGroup;
  readonly onNewThread: () => void;
}) {
  const { group } = props;
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const settings = useSettingsEnvironmentFilter();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const updateProject = useAtomCommand(projectEnvironment.update);
  const permitted = useEnvironmentsWithScope(group.projects, AuthOrchestrationOperateScope);
  const connected = new Set(useAtomValue(connectedEnvironmentIdsAtom));
  const configs = useAtomValue(environmentServerConfigsAtom);
  const pinned = group.projects.some((project) => project.pinnedAt != null);
  const canPin = group.projects.every(
    (project) =>
      permitted.has(project.environmentId) &&
      connected.has(project.environmentId) &&
      configs.get(project.environmentId)?.environment.capabilities.projectOrganization === true,
  );
  const menu = [
    {
      id: "search",
      title: translator.message("mobile.home.searchContents"),
      image: "magnifyingglass",
    },
    {
      id: "settings",
      title: translator.message("sidebar.project.menu.settings"),
      image: "gearshape",
    },
    {
      id: "pin",
      title: translator.message(pinned ? "mobile.thread.unpin" : "mobile.thread.pin"),
      image: pinned ? "pin.slash" : "pin",
      attributes: { disabled: !canPin },
    },
    {
      id: "copy-path",
      title: translator.message("sidebar.project.menu.copyPath"),
      image: "doc.on.doc",
    },
  ];
  const onMenuAction = ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
    if (nativeEvent.event === "search") requestProjectContentSearch(group.project);
    if (nativeEvent.event === "settings") {
      openSettings(navigation, "SettingsProjectOverview");
      settings.selectProject(group.scopeKey);
    }
    if (nativeEvent.event === "copy-path") copyTextWithHaptic(group.project.workspaceRoot);
    if (nativeEvent.event === "pin")
      void (async () => {
        if (!canPin) return;
        for (const project of group.projects) {
          if (!readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope)) return;
          const result = await updateProject({
            environmentId: project.environmentId,
            input: { projectId: project.id, pinned: !pinned },
          });
          if (result._tag === "Failure") return;
        }
      })();
  };
  return (
    <View className="mt-3 flex-row items-center px-4">
      <Menu style={{ flex: 1 }} actions={menu} onPressAction={onMenuAction} shouldOpenOnLongPress>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !group.collapsed }}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2"
          onPress={() =>
            savePreferences({
              transform: (current) => ({
                collapsedProjectGroups: current.collapsedProjectGroups?.includes(group.scopeKey)
                  ? current.collapsedProjectGroups.filter((key) => key !== group.scopeKey)
                  : [...(current.collapsedProjectGroups ?? []), group.scopeKey],
              }),
            })
          }
        >
          <SymbolView
            name={group.collapsed ? "chevron.right" : "chevron.down"}
            size={12}
            tintColorClassName="accent-foreground-muted"
          />
          <AppText
            className="min-w-0 flex-1 font-t3-bold text-sm text-foreground-muted"
            numberOfLines={1}
          >
            {group.title}
          </AppText>
          {group.collapsed && group.attention ? (
            <View
              accessibilityRole="image"
              accessibilityLabel={translator.message(DOT_LABELS[group.attention])}
              className={`size-2 rounded-full ${DOT_COLORS[group.attention]}`}
            />
          ) : null}
          {group.collapsed && group.hiddenThreadCount > 0 ? (
            <AppText
              accessibilityLabel={translator.message("mobile.home.hiddenThreads", {
                count: group.hiddenThreadCount,
              })}
              className="text-sm tabular-nums text-foreground-muted"
            >
              {group.hiddenThreadCount}
            </AppText>
          ) : null}
          <ProjectIndexingIndicator projects={group.projects} />
        </Pressable>
      </Menu>
      <Menu actions={menu} onPressAction={onMenuAction}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={translator.message("mobile.home.projectActions")}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <SymbolView name="ellipsis" size={18} tintColorClassName="accent-foreground-muted" />
        </View>
      </Menu>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translator.message("mobile.home.newThreadInProject", {
          project: group.title,
        })}
        className="min-h-11 min-w-11 items-center justify-center"
        onPress={props.onNewThread}
      >
        <SymbolView name="plus" size={18} tintColorClassName="accent-foreground" />
      </Pressable>
    </View>
  );
}

export function ProjectFolder(props: {
  readonly group: GroupedThreadListGroup;
  readonly onNewThread: () => void;
  readonly onToggleExpanded: () => void;
  readonly children: ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const { group } = props;
  return (
    <View>
      {group.first ? <ProjectFolderHeader group={group} onNewThread={props.onNewThread} /> : null}
      {!group.collapsed ? props.children : null}
      {group.last && !group.collapsed && group.hiddenCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center px-5"
          onPress={props.onToggleExpanded}
        >
          <AppText className="text-sm text-foreground-muted">
            {group.expanded
              ? translator.message("sidebar.classic.showLess")
              : translator.message("sidebar.classic.showMoreCount", { count: group.hiddenCount })}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
