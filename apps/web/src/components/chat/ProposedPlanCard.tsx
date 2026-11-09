import { DeepPlanChecklist } from "./DeepPlanProgress";
import {
  deepPlanSourceTitle,
  formatDeepPlanForDisplay,
} from "@t3tools/client-runtime/deep-planning";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { DeepPlanRun } from "@t3tools/contracts";
import { useChatVisualMode } from "../../chatVisualModeSync";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";
import { memo, useState, useId, type CSSProperties, type ReactNode } from "react";
import { ChatSizeMotion } from "./ChatSizeMotion";
import { useBetterT3DeviceFeature } from "../../hooks/useBetterT3Feature";
import { findRevealRef } from "./markdownFindContext";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
} from "../../proposedPlan";
import ChatMarkdown from "../ChatMarkdown";
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
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  environmentId,
  threadRef,
  cwd,
  workspaceRoot,
  findActive = false,
  deepPlan,
  actions,
  variant = "plan",
}: {
  planMarkdown: string;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | undefined;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
  findActive?: boolean;
  deepPlan?: DeepPlanRun;
  /** Icon actions shown before the plan menu, such as forking from this plan. */
  actions?: ReactNode;
  variant?: "plan" | "deep-plan";
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const better = useChatVisualMode() === "better-t3";
  const isDeepPlan = variant === "deep-plan" || Boolean(deepPlan);
  const classicBubbleOnly = useBetterT3DeviceFeature("chat.classicBubbleOnly");
  const accentedPlanBubble = better || isDeepPlan || classicBubbleOnly;
  const [expanded, setExpanded] = useState(false);
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [lastSavePath, setLastSavePath] = useState("");
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
  const isCollapsed = canCollapse && !expanded;
  // Mount clipped plans during find to count hidden matches without revealing them.
  const showPreview = isCollapsed && !findActive;
  const revealRef = findRevealRef(() => setExpanded(true));
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const handleCopyPlan = () => {
    copyToClipboard(saveContents);
  };

  const openSaveDialog = () => {
    if (!canWriteFiles) return;
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
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = (savePath: string) => {
    const relativePath = savePath.trim();
    if (!workspaceRoot || !readEnvironmentScope(environmentId, AuthFilesystemWriteScope)) {
      return;
    }
    if (!relativePath) {
      toastManager.add({
        type: "warning",
        title: translate("chat.plan.enterWorkspacePath"),
      });
      return;
    }

    setLastSavePath(savePath);
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
      data-plan-kind={isDeepPlan ? "deep-plan" : "plan"}
      data-chat-tone={better ? (isDeepPlan ? "warning" : "info") : undefined}
      className={cn(
        "rounded-2xl border p-4 sm:p-5",
        accentedPlanBubble ? "border-primary/35 bg-primary/10" : "border-border/80 bg-card/70",
        better && "better-chat-bubble better-chat-status better-chat-plan",
      )}
      style={isDeepPlan ? DEEP_PLAN_ACCENT : undefined}
    >
      <ChatSizeMotion>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant={accentedPlanBubble ? "label" : "secondary"}
              style={accentedPlanBubble ? PLAN_BADGE_ACCENT : undefined}
            >
              {translate(isDeepPlan ? "chat.deepPlan.label" : "chat.plan.label")}
            </Badge>
            <h3
              data-thread-find-text="true"
              className={cn(
                "truncate text-sm font-medium",
                accentedPlanBubble ? "text-primary" : "text-foreground",
              )}
            >
              {title}
            </h3>
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
                <MenuItem
                  onClick={openSaveDialog}
                  disabled={!canWriteFiles || !workspaceRoot || isSavingToWorkspace}
                >
                  {translate("chat.plan.saveWorkspace")}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        {deepPlan ? (
          <details className="mt-3 rounded-lg border border-border/70 px-3 text-xs">
            <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {translator.message("chat.deepPlan.sources")} ·{" "}
              {translator.message("chat.deepPlan.sourceCount", { count: deepPlan.sources.length })}
            </summary>
            <ul className="max-h-48 space-y-2 overflow-y-auto overscroll-contain pb-3">
              {deepPlan.sources.map((source) => (
                <li key={source.sourceId} className="break-words">
                  <span className="font-medium">{deepPlanSourceTitle(source)}</span>
                  {source.archived ? (
                    <span className="block text-muted-foreground">
                      {translator.message("chat.deepPlan.archived")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-4">
          <div
            ref={revealRef}
            className={cn("relative", isCollapsed && "max-h-104 overflow-hidden")}
            // A mask fades into any card tint, including the accented and Better T3 bubbles.
            style={isCollapsed ? COLLAPSED_PLAN_FADE : undefined}
            data-thread-find-text="true"
            data-thread-find-fold={isCollapsed ? "" : undefined}
          >
            {showPreview ? (
              <ChatMarkdown
                text={collapsedPreview ?? ""}
                cwd={cwd}
                environmentId={environmentId}
                threadRef={threadRef}
                isStreaming={false}
                headingLevelOffset={3}
              />
            ) : (
              <ChatMarkdown
                text={displayedPlanMarkdown}
                cwd={cwd}
                environmentId={environmentId}
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
            <DeepPlanChecklist
              run={deepPlan}
              environmentId={environmentId}
              threadId={threadRef?.threadId ?? deepPlan.threadId}
              placement="plan"
            />
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
            <SavePlanToWorkspaceForm
              initialPath={lastSavePath || downloadFilename}
              placeholder={downloadFilename}
              workspaceRoot={workspaceRoot}
              canWriteFiles={canWriteFiles}
              saving={isSavingToWorkspace}
              onCancel={() => setIsSaveDialogOpen(false)}
              onSave={handleSaveToWorkspace}
            />
          </DialogPopup>
        </Dialog>
      </ChatSizeMotion>
    </div>
  );
});

// A deep plan recolors the card's primary accent, so its badge, title and buttons follow.
const DEEP_PLAN_ACCENT = {
  "--primary": "var(--deep-plan)",
  "--primary-foreground": "var(--deep-plan-foreground)",
  "--ring": "var(--deep-plan)",
} as CSSProperties;

const PLAN_BADGE_ACCENT = { "--label": "var(--primary)" } as CSSProperties;

const COLLAPSED_PLAN_FADE = {
  maskImage: "linear-gradient(to bottom, black calc(100% - 6rem), transparent)",
} satisfies CSSProperties;

function SavePlanToWorkspaceForm({
  initialPath,
  placeholder,
  workspaceRoot,
  canWriteFiles,
  saving,
  onCancel,
  onSave,
}: {
  initialPath: string;
  placeholder: string;
  workspaceRoot: string | undefined;
  canWriteFiles: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (path: string) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const [savePath, setSavePath] = useState(initialPath);
  const savePathInputId = useId();
  return (
    <>
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
            placeholder={placeholder}
            spellCheck={false}
            disabled={saving}
          />
        </label>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          {translate("common.cancel")}
        </Button>
        <Button size="sm" onClick={() => onSave(savePath)} disabled={!canWriteFiles || saving}>
          {saving ? translate("chat.plan.saving") : translate("chat.plan.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
