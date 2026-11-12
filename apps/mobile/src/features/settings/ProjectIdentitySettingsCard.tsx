import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import {
  AuthOrchestrationOperateScope,
  ProjectIconColor,
  SidebarProjectGroupingMode,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { deriveProjectGroupingOverrideKey } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { MOBILE_PROJECT_ICON_NAMES, projectAutoMonogram } from "../../lib/projectIcon";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { projectEnvironment } from "../../state/projects";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectSettingsField, ProjectSettingsSelect } from "./ProjectSettingsFields";
import { SettingsSection } from "./components/SettingsSection";
import { parseProjectIcon } from "./project-editor-settings";

export function ProjectIdentitySettingsCard(props: {
  readonly members: readonly EnvironmentProject[];
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState<"icon" | "favicon" | null>(null);
  const [pending, setPending] = useState(false);
  const writable = useEnvironmentsWithScope(props.members, AuthOrchestrationOperateScope);
  const update = useAtomCommand(projectEnvironment.update, {
    label: "project icon update",
    reportFailure: true,
  });
  const first = props.members[0];
  if (!first) return null;
  const disabled = pending || props.members.some((project) => !writable.has(project.environmentId));
  const save = async (patch: {
    readonly projectIcon: ProjectIconOverride | null;
    readonly faviconPath: string | null;
  }) => {
    if (disabled) return;
    setPending(true);
    await (async () => {
      const results = await Promise.all(
        props.members.map((project) =>
          update({
            environmentId: project.environmentId,
            input: { projectId: project.id, ...patch },
          }),
        ),
      );
      if (results.every((result) => result._tag === "Success")) setOpen(null);
    })().finally(() => {
      setPending(false);
    });
  };
  return (
    <View className="gap-4">
      <SettingsSection title={translator.message("mobile.projects.icon.title")}>
        <View className="flex-row flex-wrap gap-2 p-4">
          <Button
            label={translator.message("mobile.projects.icon.choose")}
            disabled={disabled}
            onPress={() => setOpen(open === "icon" ? null : "icon")}
          />
          <Button
            label={translator.message("mobile.projects.icon.favicon")}
            disabled={disabled}
            onPress={() => setOpen(open === "favicon" ? null : "favicon")}
          />
          <Button
            label={translator.message("mobile.projects.reset")}
            disabled={disabled}
            tone="text"
            onPress={() => void save({ projectIcon: null, faviconPath: null })}
          />
        </View>
      </SettingsSection>
      {open === "icon" ? (
        <ProjectIconEditor
          key={`${first.environmentId}:${first.id}`}
          project={first}
          disabled={disabled}
          onSave={(projectIcon) => void save({ projectIcon, faviconPath: null })}
        />
      ) : open === "favicon" ? (
        <ProjectFaviconPicker
          project={first}
          disabled={disabled}
          onSelect={(faviconPath) => void save({ faviconPath, projectIcon: null })}
        />
      ) : null}
      <ProjectGroupingOverrides members={props.members} />
    </View>
  );
}

function ProjectIconEditor(props: {
  readonly project: EnvironmentProject;
  readonly disabled: boolean;
  readonly onSave: (icon: ProjectIconOverride) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const initial = props.project.projectIcon;
  const automatic = projectAutoMonogram(props.project.title);
  const [kind, setKind] = useState<ProjectIconOverride["kind"]>(initial?.kind ?? "lucide");
  const [color, setColor] = useState<ProjectIconColor>(
    initial && initial.kind !== "emoji"
      ? initial.color
      : automatic?.kind === "monogram"
        ? automatic.color
        : "blue",
  );
  const [iconName, setIconName] = useState(
    initial?.kind === "lucide" ? initial.name : "folder-code",
  );
  const [emoji, setEmoji] = useState(initial?.kind === "emoji" ? initial.emoji : "💻");
  const [monogram, setMonogram] = useState(
    initial?.kind === "monogram"
      ? initial.text
      : automatic?.kind === "monogram"
        ? automatic.text
        : "PR",
  );
  const parsed = parseProjectIcon(
    kind,
    kind === "lucide" ? iconName : kind === "emoji" ? emoji : monogram,
    color,
  );
  return (
    <SettingsSection title={translator.message("mobile.projects.icon.choose")}>
      <ProjectSettingsSelect
        label={translator.message("mobile.projects.icon.kind")}
        value={kind}
        options={(["lucide", "emoji", "monogram"] as const).map((value) => ({
          value,
          label: translator.message(`mobile.projects.icon.${value}`),
        }))}
        disabled={props.disabled}
        onChange={setKind}
      />
      {kind !== "emoji" ? (
        <ProjectSettingsSelect
          label={translator.message("mobile.projects.icon.color")}
          value={color}
          options={ProjectIconColor.literals.map((value) => ({
            value,
            label: translator.message(`mobile.projects.icon.color.${value}`),
          }))}
          disabled={props.disabled}
          onChange={setColor}
        />
      ) : null}
      {kind === "lucide" ? (
        <View className="flex-row flex-wrap gap-2 p-4">
          {MOBILE_PROJECT_ICON_NAMES.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityLabel={translator.message(`mobile.projects.icon.name.${name}`)}
              accessibilityState={{ checked: iconName === name, disabled: props.disabled }}
              disabled={props.disabled}
              className={
                iconName === name
                  ? "rounded-xl border border-primary p-3"
                  : "rounded-xl border border-border-subtle p-3"
              }
              onPress={() => setIconName(name)}
            >
              <ProjectFavicon
                environmentId={props.project.environmentId}
                projectTitle={props.project.title}
                projectIcon={{ kind: "lucide", name, color }}
                size={30}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <ProjectSettingsField
          label={translator.message(
            kind === "emoji" ? "mobile.projects.icon.emoji" : "mobile.projects.icon.monogram",
          )}
          value={kind === "emoji" ? emoji : monogram}
          disabled={props.disabled}
          onChange={kind === "emoji" ? setEmoji : setMonogram}
        />
      )}
      {kind === "emoji" ? (
        <View className="flex-row flex-wrap gap-2 px-4">
          {["💻", "🛠️", "🚀", "🤖", "✨", "🌐", "📱", "📦", "🧪", "🎮", "🎵", "🌱"].map((value) => (
            <Button
              key={value}
              label={value}
              tone="text"
              disabled={props.disabled}
              onPress={() => setEmoji(value)}
            />
          ))}
        </View>
      ) : null}
      <View className="gap-3 p-4">
        <AppText className="text-foreground-muted">
          {translator.message("mobile.projects.icon.sample")}
        </AppText>
        {parsed ? (
          <View className="flex-row items-center gap-4">
            {[24, 42, 60].map((size) => (
              <ProjectFavicon
                key={size}
                environmentId={props.project.environmentId}
                projectTitle={props.project.title}
                projectIcon={parsed}
                size={size}
              />
            ))}
          </View>
        ) : (
          <AppText className="text-sm text-danger">
            {translator.message("mobile.projects.icon.invalid")}
          </AppText>
        )}
        <Button
          label={translator.message("mobile.projects.save")}
          tone="primary"
          disabled={props.disabled || parsed === null}
          onPress={() => {
            if (parsed) props.onSave(parsed);
          }}
        />
      </View>
    </SettingsSection>
  );
}

function ProjectFaviconPicker(props: {
  readonly project: EnvironmentProject;
  readonly disabled: boolean;
  readonly onSelect: (path: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const files = useEnvironmentQuery(
    projectEnvironment.searchEntries({
      environmentId: props.project.environmentId,
      input: { cwd: props.project.workspaceRoot, query, kind: "file", imageOnly: true, limit: 100 },
    }),
  );
  return (
    <SettingsSection title={translator.message("mobile.projects.icon.favicon")}>
      <ProjectSettingsField
        label={translator.message("mobile.projects.icon.searchImages")}
        value={draft}
        onChange={setDraft}
      />
      <View className="p-4">
        <Button
          label={translator.message("common.search")}
          onPress={() => setQuery(draft.trim())}
        />
      </View>
      {files.error ? (
        <AppText className="p-4 text-danger">{files.error}</AppText>
      ) : files.isPending ? (
        <AppText className="p-4 text-foreground-muted">
          {translator.message("common.loading")}
        </AppText>
      ) : files.data?.entries.length === 0 ? (
        <AppText className="p-4 text-foreground-muted">
          {translator.message("mobile.projects.icon.noImages")}
        </AppText>
      ) : (
        files.data?.entries.map((entry) => (
          <Pressable
            key={entry.path}
            accessibilityRole="button"
            accessibilityLabel={entry.path}
            disabled={props.disabled}
            onPress={() => props.onSelect(entry.path)}
            className="flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
          >
            <ProjectFavicon
              environmentId={props.project.environmentId}
              projectTitle={props.project.title}
              workspaceRoot={props.project.workspaceRoot}
              faviconPath={entry.path}
              size={36}
            />
            <AppText className="flex-1 text-foreground">{entry.path}</AppText>
          </Pressable>
        ))
      )}
    </SettingsSection>
  );
}

function ProjectGroupingOverrides(props: { readonly members: readonly EnvironmentProject[] }) {
  const translator = useMobileInterfaceTranslator();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferences) && !preferences.waiting;
  return (
    <SettingsSection
      title={translator.message("mobile.settings.projectGrouping")}
      footer={translator.message("mobile.projects.grouping.description")}
    >
      {props.members.map((member) => {
        const key = deriveProjectGroupingOverrideKey(member);
        return (
          <ProjectSettingsSelect
            key={key}
            label={member.workspaceRoot}
            value={
              AsyncResult.isSuccess(preferences)
                ? (preferences.value.sidebarProjectGroupingOverrides?.[key] ?? "inherit")
                : "inherit"
            }
            options={[
              { value: "inherit", label: translator.message("mobile.projects.cleanup.inherit") },
              ...SidebarProjectGroupingMode.literals.map((value) => ({
                value,
                label: translator.message(`mobile.projects.grouping.${value}`),
              })),
            ]}
            disabled={!ready}
            onChange={(value) =>
              save({
                transform: (current) => {
                  const overrides = { ...current.sidebarProjectGroupingOverrides };
                  if (value === "inherit") delete overrides[key];
                  else if (
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  )
                    overrides[key] = value;
                  return { sidebarProjectGroupingOverrides: overrides };
                },
              })
            }
          />
        );
      })}
    </SettingsSection>
  );
}
