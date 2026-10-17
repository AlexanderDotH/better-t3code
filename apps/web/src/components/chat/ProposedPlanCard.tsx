import { memo, useState, useId, type CSSProperties, type ReactNode } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  resolveBetterT3FeatureFlag,
  type EnvironmentId,
  type ScopedThreadRef,
  type DeepPlanRun,
} from "@t3tools/contracts";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../../proposedPlan";
import ChatMarkdown from "../ChatMarkdown";
import {
  formatDeepPlanForDisplay,
  deepPlanSourceTitle,
} from "@t3tools/client-runtime/deep-planning";
import { DeepPlanChecklist } from "./DeepPlanProgress";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAtomCommand } from "~/state/use-atom-command";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { useClientSettings } from "~/hooks/useSettings";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  threadRef,
  cwd,
  workspaceRoot,
  actions,
  deepPlan,
  variant = "plan",
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  actions?: ReactNode;
  deepPlan?: DeepPlanRun;
  variant?: "plan" | "deep-plan";
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const isDeepPlan = variant === "deep-plan" || Boolean(deepPlan);
  const bluePlanBubble = useClientSettings((settings) =>
    resolveBetterT3FeatureFlag(settings.betterT3Device, "chat.classicBubbleOnly"),
  );
  const accentedPlanBubble = isDeepPlan || bluePlanBubble;
  const [expanded, setExpanded] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "plan",
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translate("chat.plan.copyFailed"),
          description: error instanceof Error ? error.message : translate("chat.plan.copyError"),
        }),
      );
    },
  });
  const savePathInputId = useId();
  const title =
    deepPlan?.plan?.goal ?? proposedPlanTitle(planMarkdown) ?? translate("chat.agent.proposedPlan");
  const bodyMarkdown = deepPlan?.plan
    ? formatDeepPlanForDisplay(deepPlan, translator, { includeImplementation: false })
    : planMarkdown;
  const lineCount = bodyMarkdown.split("\n").length;
  const canCollapse = bodyMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(bodyMarkdown);
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(bodyMarkdown, { maxLines: 10 })
    : null;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!workspaceRoot) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translate("chat.plan.workspaceUnavailable"),
          description: translate("chat.plan.workspaceUnavailableDescription"),
        }),
      );
      return;
    }
    setSavePath((existing) => (existing.length > 0 ? existing : downloadFilename));
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = () => {
    const relativePath = savePath.trim();
    if (!workspaceRoot) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: translate("chat.plan.enterWorkspacePath"),
      });
      return;
    }

    setIsSavingToWorkspace(true);
    void (async () => {
      const result = await writeProjectFile({
        environmentId,
        input: {
          cwd: workspaceRoot,
          relativePath,
          contents: saveContents,
        },
      });
      setIsSavingToWorkspace(false);
      if (result._tag === "Success") {
        setIsSaveDialogOpen(false);
        toastManager.add({
          type: "success",
          title: translate("chat.plan.saved"),
          description: result.value.relativePath,
        });
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translate("chat.plan.saveFailed"),
            description: error instanceof Error ? error.message : translate("chat.plan.saveError"),
          }),
        );
      }
    })();
  };

  return (
    <div
      className={cn(
        "rounded-3xl border p-4 sm:p-5",
        accentedPlanBubble ? "border-primary/35 bg-primary/10" : "border-border/80 bg-card/70",
      )}
      data-plan-kind={isDeepPlan ? "deep-plan" : "plan"}
      style={
        isDeepPlan
          ? ({
              "--primary": "var(--deep-plan)",
              "--primary-foreground": "var(--deep-plan-foreground)",
              "--ring": "var(--deep-plan)",
            } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge
            variant={accentedPlanBubble ? "label" : "secondary"}
            style={
              accentedPlanBubble ? ({ "--label": "var(--primary)" } as CSSProperties) : undefined
            }
          >
            {translate(isDeepPlan ? "chat.deepPlan.label" : "chat.plan.label")}
          </Badge>
          <h3
            className={cn(
              "truncate text-sm font-medium",
              accentedPlanBubble ? "text-primary" : "text-foreground",
            )}
          >
            {title}
          </h3>
          {deepPlan?.plan ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {translate("chat.deepPlan.planVersion", { version: deepPlan.plan.version })}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={translate("chat.plan.actions")}
                  size="icon-xs"
                  variant="outline"
                />
              }
            >
              <EllipsisIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={handleCopyPlan}>
                {isCopied
                  ? translate("chat.plan.copied")
                  : translate("chat.composer.copyClipboard")}
              </MenuItem>
              <MenuItem onClick={handleDownload}>
                {translate("chat.plan.downloadMarkdown")}
              </MenuItem>
              <MenuItem onClick={openSaveDialog} disabled={!workspaceRoot || isSavingToWorkspace}>
                {translate("chat.plan.saveWorkspace")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {deepPlan ? (
        <details className="mt-3 rounded-lg border border-border/70 px-3 text-xs">
          <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {translate("chat.deepPlan.sources")} ·{" "}
            {translate("chat.deepPlan.sourceCount", { count: deepPlan.sources.length })}
          </summary>
          <ul className="max-h-48 space-y-2 overflow-y-auto overscroll-contain pb-3">
            {deepPlan.sources.map((source) => (
              <li key={source.sourceId} className="break-words">
                <span className="font-medium">{deepPlanSourceTitle(source)}</span>
                {source.archived ? (
                  <span className="block text-muted-foreground">
                    {translate("chat.deepPlan.archived")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4">
        <div
          className={cn("relative", canCollapse && !expanded && "max-h-104 overflow-hidden")}
          style={
            canCollapse && !expanded
              ? { maskImage: "linear-gradient(to bottom, black calc(100% - 6rem), transparent)" }
              : undefined
          }
        >
          {canCollapse && !expanded ? (
            <ChatMarkdown
              text={collapsedPreview ?? ""}
              cwd={cwd}
              threadRef={threadRef}
              isStreaming={false}
              headingLevelOffset={3}
            />
          ) : (
            <ChatMarkdown
              text={displayedPlanMarkdown}
              cwd={cwd}
              threadRef={threadRef}
              isStreaming={false}
              headingLevelOffset={3}
            />
          )}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? translate("chat.plan.collapse") : translate("chat.plan.expand")}
            </Button>
          </div>
        ) : null}
      </div>
      {deepPlan?.plan ? (
        <div className="mt-4 border-t border-primary/20 pt-3">
          <DeepPlanChecklist run={deepPlan} placement="plan" />
        </div>
      ) : null}

      <Dialog
        open={isSaveDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingToWorkspace) {
            setIsSaveDialogOpen(open);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{translate("chat.plan.saveTitle")}</DialogTitle>
            <DialogDescription>
              {translate("chat.plan.relativePath", {
                workspace: workspaceRoot ?? translate("chat.plan.workspace"),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label htmlFor={savePathInputId} className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {translate("chat.plan.workspacePath")}
              </span>
              <Input
                id={savePathInputId}
                value={savePath}
                onChange={(event) => setSavePath(event.target.value)}
                placeholder={downloadFilename}
                spellCheck={false}
                disabled={isSavingToWorkspace}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSavingToWorkspace}
            >
              {translate("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveToWorkspace()}
              disabled={isSavingToWorkspace}
            >
              {isSavingToWorkspace ? translate("chat.plan.saving") : translate("chat.plan.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
});
