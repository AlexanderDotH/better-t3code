import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { SymbolView } from "../../../components/ui/AppSymbol";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { Button } from "../../../components/ui/Button";

export function SheetActionButton(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly disabled?: boolean;
  readonly tone?: "primary" | "secondary" | "danger";
  readonly onPress: () => void;
}) {
  return (
    <View className="flex-1">
      <Button {...props} fullWidth />
    </View>
  );
}

export function menuItemIconName(
  icon: "commit" | "push" | "pr",
): ComponentProps<typeof SymbolView>["name"] {
  if (icon === "commit") return "checkmark.circle";
  if (icon === "push") return "arrow.up.circle";
  return "arrow.up.right.circle";
}

export function statusSummary(
  gitStatus: {
    readonly isRepo?: boolean;
    readonly hasWorkingTreeChanges?: boolean;
    readonly workingTree?: { readonly files: readonly { readonly path: string }[] };
    readonly aheadCount?: number;
    readonly behindCount?: number;
    readonly pr?: { readonly state?: string; readonly number?: number } | null;
    readonly sourceControlProvider?: { readonly kind: string } | null;
  } | null,
  translator: InterfaceTranslator,
): string {
  if (!gitStatus) {
    return translator.message("mobile.git.checkingStatus");
  }

  if (!gitStatus.isRepo) {
    return translator.message("mobile.git.notRepository");
  }

  const parts: string[] = [];
  if (gitStatus.hasWorkingTreeChanges) {
    const fileCount = gitStatus.workingTree?.files.length ?? 0;
    parts.push(translator.message("git.overview.filesChanged", { count: fileCount }));
  } else {
    parts.push(translator.message("mobile.git.cleanShort"));
  }
  if ((gitStatus.aheadCount ?? 0) > 0) {
    parts.push(translator.message("mobile.git.aheadCount", { count: gitStatus.aheadCount ?? 0 }));
  }
  if ((gitStatus.behindCount ?? 0) > 0) {
    parts.push(translator.message("mobile.git.behindCount", { count: gitStatus.behindCount ?? 0 }));
  }
  if (gitStatus.pr?.state === "open") {
    const { shortLabel } = sourceControlClients.get(
      gitStatus.sourceControlProvider?.kind,
    ).changeRequest;
    parts.push(
      `${shortLabel} #${gitStatus.pr.number} ${translator.message("pullRequest.state.open")}`,
    );
  }

  return parts.join(" \u00b7 ");
}
