import type {
  EnvironmentId,
  ProjectIndexQueryResultV1,
  ProjectIndexScopeInput,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobileProjectIndexFacts } from "./mobile-project-index-facts";
import { ProjectIndexSourceButton } from "./ProjectIndexSourceButton";

export function ProjectIndexFacts(props: {
  readonly result: ProjectIndexQueryResultV1;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
}) {
  const translator = useMobileInterfaceTranslator();
  const facts = useMemo(() => mobileProjectIndexFacts(props.result), [props.result]);
  const packageNames = new Map(props.result.modules.map((module) => [module.id, module.name]));

  if (
    facts.packages.length === 0 &&
    facts.imports.length === 0 &&
    facts.rules.length === 0 &&
    facts.sources.length === 0
  )
    return null;

  return (
    <View className="gap-4">
      {facts.packages.length > 0 ? (
        <View className="gap-2">
          <Text className="font-t3-semibold text-foreground">
            {translator.message("projectIndexing.staticPackages")}
          </Text>
          {facts.packages.map((module) => (
            <View key={module.id} className="gap-1 rounded-xl bg-subtle p-3">
              <Text className="text-sm font-t3-semibold text-foreground" selectable>
                {module.name}
              </Text>
              {module.summary ? (
                <Text className="text-sm text-foreground-muted" selectable>
                  {module.summary}
                </Text>
              ) : null}
              {module.filePaths.map((path) => (
                <Text key={path} className="font-mono text-xs text-foreground-muted" selectable>
                  {path}
                </Text>
              ))}
              {module.dependsOnModuleIds.length > 0 ? (
                <Text className="text-xs text-foreground-muted" selectable>
                  {translator.message("projectIndexing.staticDependencies")}:{" "}
                  {module.dependsOnModuleIds.map((id) => packageNames.get(id) ?? id).join(", ")}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {facts.imports.length > 0 ? (
        <View className="gap-2">
          <Text className="font-t3-semibold text-foreground">
            {translator.message("projectIndexing.staticDependencies")}
          </Text>
          {facts.imports.map((record) => (
            <View key={record.id} className="gap-2 rounded-xl bg-subtle p-3">
              <Text className="font-mono text-sm text-foreground" selectable>
                {record.specifier}
              </Text>
              <Text className="text-xs text-foreground-muted" selectable>
                {record.filePath}:{record.range.startLine}:{record.range.startColumn} ·{" "}
                {translator.message(`projectIndexing.importResolution.${record.resolution}`)}
                {record.targetPath
                  ? ` → ${record.targetPath}`
                  : record.packageName
                    ? ` → ${record.packageName}`
                    : ""}
              </Text>
              <ProjectIndexSourceButton
                environmentId={props.environmentId}
                scope={props.scope}
                source={record}
              />
            </View>
          ))}
        </View>
      ) : null}
      {facts.rules.length > 0 ? (
        <View className="gap-2">
          <Text className="font-t3-semibold text-foreground">
            {translator.message("projectIndexing.staticRules")}
          </Text>
          {facts.rules.map((rule) => (
            <View key={rule.id} className="gap-1 rounded-xl bg-subtle p-3">
              <Text className="text-sm font-t3-semibold text-foreground" selectable>
                {rule.name}
              </Text>
              <Text className="text-sm text-foreground-muted" selectable>
                {rule.description}
              </Text>
              {rule.evidenceIds.map((id) => {
                const source = props.result.evidence.find((evidence) => evidence.id === id);
                return source ? (
                  <Text key={id} className="font-mono text-xs text-foreground-muted" selectable>
                    {source.filePath}:{source.range.startLine}
                  </Text>
                ) : null;
              })}
            </View>
          ))}
        </View>
      ) : null}
      {facts.sources.length > 0 ? (
        <View className="gap-2">
          <Text className="font-t3-semibold text-foreground">
            {translator.message("projectIndexing.staticSources")}
          </Text>
          {facts.sources.map((source) => (
            <View key={source.id} className="gap-2 rounded-xl bg-subtle p-3">
              <Text className="font-mono text-xs text-foreground-muted" selectable>
                {source.filePath}:{source.range.startLine}
              </Text>
              {source.excerpt ? (
                <Text className="font-mono text-xs text-foreground" selectable>
                  {source.excerpt}
                </Text>
              ) : null}
              <ProjectIndexSourceButton
                environmentId={props.environmentId}
                scope={props.scope}
                source={source}
              />
            </View>
          ))}
        </View>
      ) : null}
      {facts.omitted > 0 ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("projectIndexing.detailTruncated")}
        </Text>
      ) : null}
    </View>
  );
}
