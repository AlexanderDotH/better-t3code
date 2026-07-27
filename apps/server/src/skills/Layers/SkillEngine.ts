import {
  ProviderDriverKind,
  ProviderInstanceId,
  SkillEngineError,
  type ServerSettings,
  type SkillDescriptor,
  type SkillMutationScope,
  type SkillScope,
  type SkillTarget,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import {
  discoverAgentImportSources,
  importSkillsFromAgentSources,
  type AgentImportedSkill,
} from "../../agentImportSources.ts";
import { writeFileStringAtomically } from "../../atomicWrite.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import { SkillEngine, type SkillEngineShape } from "../Services/SkillEngine.ts";
import {
  isValidSkillName,
  parseSkillFile,
  serializeSkillFile,
  type ParsedSkillFile,
} from "../skillFile.ts";

const SKILL_FILE_NAME = "SKILL.md";
const RESERVED_SLASH_COMMANDS = new Set(["model", "plan", "default"]);
const PROMPT_SKILL_NAME_PATTERN = "[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}";
const BUILT_IN_PROVIDERS = new Set(["codex", "cursor", "claudeAgent", "opencode"]);

interface SkillRoots {
  readonly globalRoot: string;
  readonly projectRoot?: string | undefined;
}

interface OwnedSkillTarget {
  readonly scope: SkillMutationScope;
  readonly projectId?: SkillTarget["projectId"] | undefined;
  readonly projectCwd?: string | undefined;
  readonly root: string;
  readonly skillDir: string;
  readonly skillPath: string;
  readonly name: string;
}

const toSkillError = (message: string, cause?: unknown): SkillEngineError =>
  new SkillEngineError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

const mapSkillError =
  (message: string) =>
  (cause: unknown): SkillEngineError =>
    toSkillError(message, cause);

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isPathInside(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function skillId(input: { readonly scope: SkillScope; readonly path: string }): string {
  return `${input.scope}:${input.path}`;
}

function globalSkillRoot(path: Path.Path, stateDir: string): string {
  return path.join(stateDir, "skills");
}

function projectSkillRoot(path: Path.Path, projectCwd: string): string {
  return path.join(path.resolve(projectCwd), ".t3code", "skills");
}

function skillFilePath(path: Path.Path, root: string, name: string): string {
  return path.join(root, name, SKILL_FILE_NAME);
}

function assertValidSkillName(name: string): Effect.Effect<void, SkillEngineError> {
  if (isValidSkillName(name)) {
    return Effect.void;
  }
  return Effect.fail(
    toSkillError(
      "Skill names must start with a letter or number and contain only letters, numbers, dashes, or underscores.",
    ),
  );
}

function readSkillFile(
  filePath: string,
): Effect.Effect<ParsedSkillFile, SkillEngineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs
      .readFileString(filePath)
      .pipe(Effect.mapError(mapSkillError(`Failed to read skill file '${filePath}'.`)));
    return parseSkillFile(contents);
  });
}

function readSkillFileOptional(
  filePath: string,
): Effect.Effect<ParsedSkillFile | null, never, FileSystem.FileSystem> {
  return readSkillFile(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
}

function providerSupportFromSettings(settings: ServerSettings): SkillDescriptor["providerSupport"] {
  const instanceEntries = Object.entries(settings.providerInstances)
    .filter(([, instance]) => instance.enabled ?? true)
    .map(([instanceId, instance]) => ({
      provider: instance.driver,
      instanceId: ProviderInstanceId.make(instanceId),
      state: BUILT_IN_PROVIDERS.has(instance.driver) ? ("ready" as const) : ("limited" as const),
      message: BUILT_IN_PROVIDERS.has(instance.driver)
        ? "T3 expands enabled skills before dispatch."
        : "This provider has not been verified with T3 skill expansion.",
    }));

  if (instanceEntries.length > 0) {
    return instanceEntries;
  }

  return Object.entries(settings.providers)
    .filter(([, provider]) => provider.enabled)
    .map(([driver]) => ({
      provider: ProviderDriverKind.make(driver),
      instanceId: ProviderInstanceId.make(driver),
      state: "ready" as const,
      message: "T3 expands enabled skills before dispatch.",
    }));
}

function descriptorFromFile(input: {
  readonly scope: SkillMutationScope;
  readonly path: string;
  readonly enabled: boolean;
  readonly providerSupport: SkillDescriptor["providerSupport"];
  readonly projectId?: SkillDescriptor["projectId"] | undefined;
  readonly projectCwd?: string | undefined;
  readonly parsed: ParsedSkillFile;
  readonly fallbackName: string;
  readonly includeBody: boolean;
}): SkillDescriptor {
  const name = input.parsed.name?.trim() || input.fallbackName;
  return {
    id: skillId({
      scope: input.scope,
      path: input.path,
    }),
    name,
    path: input.path,
    scope: input.scope,
    enabled: input.enabled,
    readOnly: false,
    providerSupport: input.providerSupport,
    ...(input.parsed.description ? { description: input.parsed.description } : {}),
    ...(input.parsed.displayName ? { displayName: input.parsed.displayName } : {}),
    ...(input.parsed.shortDescription ? { shortDescription: input.parsed.shortDescription } : {}),
    ...(input.includeBody ? { body: input.parsed.body } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
  };
}

function sortSkills(skills: ReadonlyArray<SkillDescriptor>): SkillDescriptor[] {
  const scopeRank: Record<SkillScope, number> = {
    project: 0,
    global: 1,
    system: 2,
  };
  return skills.toSorted(
    (left, right) =>
      scopeRank[left.scope] - scopeRank[right.scope] ||
      left.name.localeCompare(right.name) ||
      left.path.localeCompare(right.path),
  );
}

function uniqueImportedSkillName(input: {
  readonly preferredName: string;
  readonly reservedNames: Set<string>;
}): string {
  const base = isValidSkillName(input.preferredName) ? input.preferredName : "imported_skill";
  let candidate = base;
  let suffix = 2;
  while (input.reservedNames.has(candidate)) {
    const text = `_${suffix}`;
    candidate = `${base.slice(0, 64 - text.length)}${text}`;
    suffix += 1;
  }
  input.reservedNames.add(candidate);
  return candidate;
}

function scanLocalSkillRoot(input: {
  readonly scope: SkillMutationScope;
  readonly root: string;
  readonly includeBody: boolean;
  readonly disabledSkillIds: ReadonlySet<string>;
  readonly providerSupport: SkillDescriptor["providerSupport"];
  readonly projectId?: SkillDescriptor["projectId"] | undefined;
  readonly projectCwd?: string | undefined;
}): Effect.Effect<ReadonlyArray<SkillDescriptor>, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(input.root).pipe(Effect.orElseSucceed(() => []));
    return yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const filePath = skillFilePath(path, input.root, entry);
          const parsed = yield* readSkillFileOptional(filePath);
          if (!parsed) {
            return null;
          }
          const id = skillId({ scope: input.scope, path: filePath });
          return descriptorFromFile({
            scope: input.scope,
            path: filePath,
            enabled: !input.disabledSkillIds.has(id),
            providerSupport: input.providerSupport,
            parsed,
            fallbackName: entry,
            includeBody: input.includeBody,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
        }),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((items) => items.filter((item): item is SkillDescriptor => item !== null)));
  });
}

function resolveSkillRoots(input: {
  readonly stateDir: string;
  readonly projectCwd?: string | undefined;
}): Effect.Effect<SkillRoots, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    return {
      globalRoot: globalSkillRoot(path, input.stateDir),
      ...(input.projectCwd ? { projectRoot: projectSkillRoot(path, input.projectCwd) } : {}),
    };
  });
}

function resolveOwnedTarget(input: {
  readonly roots: SkillRoots;
  readonly target: SkillTarget;
}): Effect.Effect<OwnedSkillTarget, SkillEngineError, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    if (input.target.scope === "system") {
      return yield* toSkillError("System skills are read-only in T3 Code.");
    }

    const projectCwd = input.target.projectCwd;
    if (input.target.scope === "project" && !projectCwd) {
      return yield* toSkillError("Project skill operations require a project cwd.");
    }

    const root = input.target.scope === "global" ? input.roots.globalRoot : input.roots.projectRoot;
    if (!root) {
      return yield* toSkillError("Project skill operations require a project cwd.");
    }

    const resolvedRoot = path.resolve(root);
    const skillPath = input.target.path
      ? path.resolve(input.target.path)
      : input.target.name
        ? skillFilePath(path, resolvedRoot, input.target.name)
        : null;

    if (!skillPath) {
      return yield* toSkillError("Skill target requires a name or path.");
    }
    if (!isPathInside(path, resolvedRoot, skillPath)) {
      return yield* toSkillError("Skill path is outside the requested skill scope.");
    }
    if (path.basename(skillPath) !== SKILL_FILE_NAME) {
      return yield* toSkillError("Skill target path must point to SKILL.md.");
    }

    const skillDir = path.dirname(skillPath);
    const name = input.target.name ?? path.basename(skillDir);
    yield* assertValidSkillName(name);
    return {
      scope: input.target.scope,
      root: resolvedRoot,
      skillDir,
      skillPath,
      name,
      ...(input.target.projectId ? { projectId: input.target.projectId } : {}),
      ...(projectCwd ? { projectCwd } : {}),
    };
  });
}

function writeSkillFile(input: {
  readonly target: OwnedSkillTarget;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly displayName?: string | undefined;
  readonly shortDescription?: string | undefined;
}): Effect.Effect<void, SkillEngineError, FileSystem.FileSystem | Path.Path> {
  const displayName = normalizeOptional(input.displayName);
  const shortDescription = normalizeOptional(input.shortDescription);
  return writeFileStringAtomically({
    filePath: input.target.skillPath,
    contents: serializeSkillFile(
      {
        name: input.name,
        description: input.description,
        ...(displayName ? { displayName } : {}),
        ...(shortDescription ? { shortDescription } : {}),
      },
      input.body,
    ),
  }).pipe(Effect.mapError(mapSkillError("Failed to write skill file.")));
}

function importSkillToTarget(input: {
  readonly roots: SkillRoots;
  readonly scope: SkillMutationScope;
  readonly projectId?: SkillDescriptor["projectId"] | undefined;
  readonly projectCwd?: string | undefined;
  readonly skill: AgentImportedSkill;
  readonly reservedNames: Set<string>;
}): Effect.Effect<void, SkillEngineError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const name = uniqueImportedSkillName({
      preferredName: input.skill.name,
      reservedNames: input.reservedNames,
    });
    const target = yield* resolveOwnedTarget({
      roots: input.roots,
      target: {
        scope: input.scope,
        name,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
      },
    });
    yield* writeSkillFile({
      target,
      name,
      description: input.skill.description,
      body: input.skill.body,
      ...(input.skill.displayName ? { displayName: input.skill.displayName } : {}),
      ...(input.skill.shortDescription ? { shortDescription: input.skill.shortDescription } : {}),
    });
  });
}

function localDescriptorForTarget(input: {
  readonly target: OwnedSkillTarget;
  readonly settings: ServerSettings;
  readonly includeBody: boolean;
}): Effect.Effect<SkillDescriptor, SkillEngineError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const parsed = yield* readSkillFile(input.target.skillPath);
    const id = skillId({ scope: input.target.scope, path: input.target.skillPath });
    return descriptorFromFile({
      scope: input.target.scope,
      path: input.target.skillPath,
      enabled: !input.settings.skills.disabledSkillIds.includes(id),
      providerSupport: providerSupportFromSettings(input.settings),
      parsed,
      fallbackName: input.target.name,
      includeBody: input.includeBody,
      ...(input.target.projectId ? { projectId: input.target.projectId } : {}),
      ...(input.target.projectCwd ? { projectCwd: input.target.projectCwd } : {}),
    });
  });
}

function setSkillEnabledInSettings(input: {
  readonly serverSettings: ServerSettingsShape;
  readonly id: string;
  readonly enabled: boolean;
}): Effect.Effect<ServerSettings, SkillEngineError> {
  return input.serverSettings.getSettings.pipe(
    Effect.flatMap((settings) => {
      const disabled = new Set(settings.skills.disabledSkillIds);
      if (input.enabled) {
        disabled.delete(input.id);
      } else {
        disabled.add(input.id);
      }
      return input.serverSettings.updateSettings({
        skills: { disabledSkillIds: [...disabled].toSorted() },
      });
    }),
    Effect.mapError(mapSkillError("Failed to update skill settings.")),
  );
}

function removeDisabledSkillIds(input: {
  readonly serverSettings: ServerSettingsShape;
  readonly ids: ReadonlyArray<string>;
}): Effect.Effect<ServerSettings, SkillEngineError> {
  return input.serverSettings.getSettings.pipe(
    Effect.flatMap((settings) => {
      const removed = new Set(input.ids);
      const disabledSkillIds = settings.skills.disabledSkillIds.filter((id) => !removed.has(id));
      if (disabledSkillIds.length === settings.skills.disabledSkillIds.length) {
        return Effect.succeed(settings);
      }
      return input.serverSettings.updateSettings({ skills: { disabledSkillIds } });
    }),
    Effect.mapError(mapSkillError("Failed to update skill settings.")),
  );
}

function transferDisabledSkillId(input: {
  readonly serverSettings: ServerSettingsShape;
  readonly fromId: string;
  readonly toId: string;
}): Effect.Effect<ServerSettings, SkillEngineError> {
  return input.serverSettings.getSettings.pipe(
    Effect.flatMap((settings) => {
      const disabled = new Set(settings.skills.disabledSkillIds);
      const wasDisabled = disabled.delete(input.fromId);
      if (wasDisabled) {
        disabled.add(input.toId);
      }
      return input.serverSettings.updateSettings({
        skills: { disabledSkillIds: [...disabled].toSorted() },
      });
    }),
    Effect.mapError(mapSkillError("Failed to update skill settings.")),
  );
}

function skillPromptBlock(skill: SkillDescriptor): string {
  const displayName = skill.displayName?.trim() || skill.name;
  const description = skill.shortDescription ?? skill.description ?? `T3 skill ${skill.name}`;
  const body = skill.body?.trim() ?? "";
  return [
    `<t3-skill name="${skill.name}">`,
    `Title: ${displayName}`,
    `Description: ${description}`,
    "",
    body,
    "</t3-skill>",
  ].join("\n");
}

function rewritePromptWithSkills(input: {
  readonly prompt: string;
  readonly skills: ReadonlyArray<SkillDescriptor>;
}): string {
  const enabledByName = new Map<string, SkillDescriptor>();
  for (const skill of input.skills) {
    if (
      skill.enabled &&
      !RESERVED_SLASH_COMMANDS.has(skill.name) &&
      !enabledByName.has(skill.name)
    ) {
      // `list` orders the most-specific project scope before global scope.
      // Preserve that first match so a global skill cannot shadow a
      // project-local skill with the same invocation name.
      enabledByName.set(skill.name, skill);
    }
  }
  if (enabledByName.size === 0) {
    return input.prompt;
  }

  let changed = false;
  const pattern = new RegExp(`(^|\\s)([$/])(${PROMPT_SKILL_NAME_PATTERN})(?=$|\\s)`, "g");
  const rewritten = input.prompt.replace(pattern, (match, prefix: string, _sigil: string, name) => {
    const skill = enabledByName.get(name);
    if (!skill) {
      return match;
    }
    changed = true;
    return `${prefix}${skillPromptBlock(skill)}\n\n`;
  });
  return changed ? rewritten : input.prompt;
}

function makeSkillEngine(): Effect.Effect<
  SkillEngineShape,
  never,
  FileSystem.FileSystem | Path.Path | ServerConfig | ServerSettingsService
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const serverSettings = yield* ServerSettingsService;

    const provideCaptured = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ServerConfig, serverConfig),
        Effect.provideService(ServerSettingsService, serverSettings),
      );

    const list: SkillEngineShape["list"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.mapError(mapSkillError("Failed to read server settings.")),
          );
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
          const disabledSkillIds = new Set(settings.skills.disabledSkillIds);
          const providerSupport = providerSupportFromSettings(settings);
          const globalSkills = yield* scanLocalSkillRoot({
            scope: "global",
            root: roots.globalRoot,
            includeBody: input.includeBody ?? false,
            disabledSkillIds,
            providerSupport,
          });
          const projectSkills = roots.projectRoot
            ? yield* scanLocalSkillRoot({
                scope: "project",
                root: roots.projectRoot,
                includeBody: input.includeBody ?? false,
                disabledSkillIds,
                providerSupport,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
              })
            : [];
          return { skills: sortSkills([...globalSkills, ...projectSkills]) };
        }),
      );

    const discoverImportSources: SkillEngineShape["discoverImportSources"] = provideCaptured(
      serverSettings.getSettings.pipe(
        Effect.flatMap((settings) => discoverAgentImportSources({ settings })),
        Effect.mapError(mapSkillError("Failed to discover agent import sources.")),
      ),
    );

    const importSources: SkillEngineShape["importSources"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          if (input.scope === "project" && (!input.projectId || !input.projectCwd)) {
            return yield* toSkillError("Project skill imports require a project and project cwd.");
          }
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.mapError(mapSkillError("Failed to read server settings.")),
          );
          const existing = yield* list({
            includeBody: input.deduplicate ?? true,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
          const existingInScope = existing.skills.filter((skill) => skill.scope === input.scope);
          const imported = yield* importSkillsFromAgentSources({
            sourceIds: input.sourceIds,
            settings,
            existingSkills: existingInScope,
            deduplicate: input.deduplicate,
          });
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
          const reservedNames = new Set(existingInScope.map((skill) => skill.name));
          yield* Effect.forEach(
            imported,
            (skill) =>
              importSkillToTarget({
                roots,
                scope: input.scope,
                skill,
                reservedNames,
                ...(input.projectId ? { projectId: input.projectId } : {}),
                ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
              }),
            { concurrency: "unbounded" },
          );
          return yield* list({
            includeBody: true,
            forceReload: true,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
        }),
      );

    const create: SkillEngineShape["create"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          yield* assertValidSkillName(input.name);
          if (input.scope === "project" && (!input.projectId || !input.projectCwd)) {
            return yield* toSkillError(
              "Project skill operations require a project and project cwd.",
            );
          }
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          });
          const target = yield* resolveOwnedTarget({
            roots,
            target: {
              scope: input.scope,
              name: input.name,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
            },
          });
          if (yield* fs.exists(target.skillPath).pipe(Effect.orElseSucceed(() => false))) {
            return yield* toSkillError(`Skill '${input.name}' already exists.`);
          }
          yield* writeSkillFile({
            target,
            name: input.name,
            description: input.description,
            body: input.body,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.shortDescription !== undefined
              ? { shortDescription: input.shortDescription }
              : {}),
          });
          const id = skillId({ scope: target.scope, path: target.skillPath });
          const settings =
            input.enabled === false
              ? yield* setSkillEnabledInSettings({ serverSettings, id, enabled: false })
              : yield* serverSettings.getSettings.pipe(
                  Effect.mapError(mapSkillError("Failed to read server settings.")),
                );
          const skill = yield* localDescriptorForTarget({
            target,
            settings,
            includeBody: true,
          });
          return { skill };
        }),
      );

    const update: SkillEngineShape["update"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.target.projectCwd ? { projectCwd: input.target.projectCwd } : {}),
          });
          const target = yield* resolveOwnedTarget({ roots, target: input.target });
          const parsed = yield* readSkillFile(target.skillPath);
          const description = input.description ?? parsed.description;
          if (!description) {
            return yield* toSkillError("Skill description is required.");
          }
          yield* writeSkillFile({
            target,
            name: parsed.name ?? target.name,
            description,
            body: input.body ?? parsed.body,
            displayName:
              input.displayName !== undefined
                ? input.displayName
                : (parsed.displayName ?? undefined),
            shortDescription:
              input.shortDescription !== undefined
                ? input.shortDescription
                : (parsed.shortDescription ?? undefined),
          });
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.mapError(mapSkillError("Failed to read server settings.")),
          );
          const skill = yield* localDescriptorForTarget({
            target,
            settings,
            includeBody: true,
          });
          return { skill };
        }),
      );

    const rename: SkillEngineShape["rename"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          yield* assertValidSkillName(input.newName);
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.target.projectCwd ? { projectCwd: input.target.projectCwd } : {}),
          });
          const target = yield* resolveOwnedTarget({ roots, target: input.target });
          const nextPath = skillFilePath(path, target.root, input.newName);
          const nextDir = path.dirname(nextPath);
          if (yield* fs.exists(nextPath).pipe(Effect.orElseSucceed(() => false))) {
            return yield* toSkillError(`Skill '${input.newName}' already exists.`);
          }
          const parsed = yield* readSkillFile(target.skillPath);
          yield* fs
            .rename(target.skillDir, nextDir)
            .pipe(Effect.mapError(mapSkillError("Failed to rename skill directory.")));
          const nextTarget = {
            ...target,
            name: input.newName,
            skillDir: nextDir,
            skillPath: nextPath,
          };
          yield* writeSkillFile({
            target: nextTarget,
            name: input.newName,
            description: parsed.description ?? input.newName,
            body: parsed.body,
            displayName: parsed.displayName ?? undefined,
            shortDescription: parsed.shortDescription ?? undefined,
          });
          const settings = yield* transferDisabledSkillId({
            serverSettings,
            fromId: skillId({ scope: target.scope, path: target.skillPath }),
            toId: skillId({ scope: nextTarget.scope, path: nextTarget.skillPath }),
          });
          const skill = yield* localDescriptorForTarget({
            target: nextTarget,
            settings,
            includeBody: true,
          });
          return { skill };
        }),
      );

    const remove: SkillEngineShape["delete"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.target.projectCwd ? { projectCwd: input.target.projectCwd } : {}),
          });
          const target = yield* resolveOwnedTarget({ roots, target: input.target });
          yield* fs
            .remove(target.skillDir, { recursive: true, force: true })
            .pipe(Effect.mapError(mapSkillError("Failed to delete skill directory.")));
          yield* removeDisabledSkillIds({
            serverSettings,
            ids: [skillId({ scope: target.scope, path: target.skillPath })],
          });
          return yield* list({
            includeBody: true,
            forceReload: true,
            ...(target.projectId ? { projectId: target.projectId } : {}),
            ...(target.projectCwd ? { projectCwd: target.projectCwd } : {}),
          });
        }),
      );

    const setEnabled: SkillEngineShape["setEnabled"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          const roots = yield* resolveSkillRoots({
            stateDir: serverConfig.stateDir,
            ...(input.target.projectCwd ? { projectCwd: input.target.projectCwd } : {}),
          });
          const target = yield* resolveOwnedTarget({ roots, target: input.target });
          const id = skillId({ scope: target.scope, path: target.skillPath });
          const settings = yield* setSkillEnabledInSettings({
            serverSettings,
            id,
            enabled: input.enabled,
          });
          const skill = yield* localDescriptorForTarget({
            target,
            settings,
            includeBody: true,
          });
          return { skill };
        }),
      );

    const rewritePromptForProvider: SkillEngineShape["rewritePromptForProvider"] = (input) =>
      provideCaptured(
        Effect.gen(function* () {
          const result = yield* list({
            includeBody: true,
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
          }).pipe(Effect.result);
          if (Result.isFailure(result)) {
            return input.prompt;
          }
          return rewritePromptWithSkills({
            prompt: input.prompt,
            skills: result.success.skills,
          });
        }),
      );

    return {
      list,
      discoverImportSources,
      importSources,
      create,
      update,
      rename,
      delete: remove,
      setEnabled,
      rewritePromptForProvider,
    } satisfies SkillEngineShape;
  });
}

export const SkillEngineLive = Layer.effect(SkillEngine, makeSkillEngine());
