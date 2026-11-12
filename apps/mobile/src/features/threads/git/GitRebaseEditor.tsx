import type { GitRebaseTodoNode } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { isValidRebasePlan } from "./rebase-plan";
import { WorkbenchButton, WorkbenchInput } from "./WorkbenchControls";

const COMMIT_ACTIONS = ["pick", "reword", "edit", "squash", "fixup", "drop"] as const;

export function GitRebaseEditor(props: {
  readonly nodes: ReadonlyArray<GitRebaseTodoNode>;
  readonly disabled: boolean;
  readonly onChange: (nodes: ReadonlyArray<GitRebaseTodoNode>) => void;
  readonly subjects?: ReadonlyMap<string, string>;
  readonly parents?: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
  const t = useMobileInterfaceTranslator();
  const replace = (index: number, node: GitRebaseTodoNode) =>
    props.onChange(props.nodes.map((current, position) => (position === index ? node : current)));
  const move = (index: number, offset: number) => {
    const destination = index + offset;
    if (destination < 0 || destination >= props.nodes.length) return;
    const next = [...props.nodes];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    props.onChange(next);
  };
  return (
    <View className="gap-3">
      {props.nodes.map((node, index) => (
        <View
          key={"oid" in node ? node.oid : `${node.kind}:${"name" in node ? node.name : node.label}`}
          className="gap-2 border-t border-border-subtle pt-3"
        >
          <AppText className="text-sm text-foreground">
            {index + 1}.{" "}
            {"oid" in node
              ? `${node.oid.slice(0, 10)} ${props.subjects?.get(node.oid) ?? ""}`
              : `${node.kind} ${"name" in node ? node.name : node.label}`}
          </AppText>
          {"oid" in node ? (
            <View className="flex-row flex-wrap gap-1">
              {COMMIT_ACTIONS.map((kind) => (
                <WorkbenchButton
                  key={kind}
                  disabled={props.disabled}
                  selected={node.kind === kind}
                  label={kind}
                  onPress={() =>
                    replace(
                      index,
                      kind === "reword"
                        ? {
                            kind,
                            oid: node.oid,
                            message: props.subjects?.get(node.oid) ?? node.oid,
                          }
                        : { kind, oid: node.oid },
                    )
                  }
                />
              ))}
            </View>
          ) : null}
          {node.kind === "reword" ? (
            <WorkbenchInput
              label={t.message("git.operation.newCommitMessage")}
              value={node.message ?? ""}
              editable={!props.disabled}
              onChangeText={(message) => replace(index, { ...node, message })}
            />
          ) : null}
          <View className="flex-row gap-2">
            <WorkbenchButton
              label="↑"
              disabled={props.disabled || index === 0}
              onPress={() => move(index, -1)}
            />
            <WorkbenchButton
              label="↓"
              disabled={props.disabled || index === props.nodes.length - 1}
              onPress={() => move(index, 1)}
            />
          </View>
        </View>
      ))}
      {!isValidRebasePlan(props.nodes, props.parents) ? (
        <AppText className="text-sm text-amber-600">
          {t.message("mobile.gitParity.rebaseInvalid")}
        </AppText>
      ) : null}
    </View>
  );
}
