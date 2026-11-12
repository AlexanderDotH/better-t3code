import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolvePullRequestPreviewTarget } from "@t3tools/client-runtime/change-request-links";
import { planThreadPullRequestMutation } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
} from "@t3tools/client-runtime/thread-pull-requests";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";
import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import { AppText } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { composerPullRequests } from "../../state/pull-requests";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { PullRequestAvatar } from "../pull-requests/PullRequestPresentation";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

const parser = unified().use(remarkParse).use(remarkGfm);

function pullRequestUrls(markdown: string) {
  if (!markdown.includes("http")) return [];
  const urls = new Set<string>();
  const visit = (node: Nodes) => {
    if (node.type === "link" && sourceControlClients.parseChangeRequestUrl(node.url))
      urls.add(node.url);
    else if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  return [...urls];
}

export function useTimelinePullRequestLinks(environmentId: EnvironmentId, threadId: ThreadId) {
  const translator = useMobileInterfaceTranslator();
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const runtime = useRemoteEnvironmentRuntime(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const link = useAtomCommand(threadEnvironment.linkPullRequest, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: false });
  const reference = (url: string) => {
    const parsed = sourceControlClients.parseChangeRequestUrl(url)?.link;
    return parsed
      ? {
          ...normalizeThreadPullRequestKey({
            host: parsed.authority ?? parsed.host,
            repository: parsed.repository,
            number: parsed.number,
          }),
          url,
        }
      : null;
  };
  const isLinked = (url: string) => {
    const key = reference(url);
    return (
      key !== null &&
      thread?.pullRequests.some(
        (entry) => entry.source !== "stack-dismissed" && threadPullRequestKeysEqual(entry, key),
      ) === true
    );
  };
  const canEdit =
    canOperate && runtime?.connectionState === "connected" && runtime.serverConfig !== null;
  const actions = (url: string) =>
    reference(url) === null || !canEdit
      ? []
      : [
          {
            id: "timeline-toggle-pr",
            title: translator.message(
              isLinked(url) ? "mobile.timeline.unlinkPr" : "mobile.timeline.linkPr",
            ),
          },
        ];
  const perform = (url: string, action: string) => {
    if (action !== "timeline-toggle-pr" || !canEdit) return;
    const key = reference(url);
    if (!key) return;
    const mutation = planThreadPullRequestMutation({
      capabilities: runtime.serverConfig?.environment.capabilities,
      threadId,
      reference: key,
      linked: !isLinked(url),
    });
    if (!mutation) return;
    const result =
      mutation.type === "thread.pull-request.link"
        ? link({ environmentId, input: mutation.input })
        : unlink({ environmentId, input: mutation.input });
    void result.then((answer) => {
      if (answer._tag === "Failure" && !isAtomCommandInterrupted(answer)) {
        const cause = squashAtomCommandFailure(answer);
        Dialog.alert(
          translator.message("mobile.timeline.failed"),
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    });
  };
  return { actions, perform };
}

type LinkActions = ReturnType<typeof useTimelinePullRequestLinks>;
export const TimelinePullRequestCards = memo(function TimelinePullRequestCards(props: {
  readonly markdown: string;
  readonly environmentId: EnvironmentId;
  readonly actions: LinkActions;
  readonly onOpen: (url: string) => Promise<boolean>;
}) {
  const urls = useMemo(() => pullRequestUrls(props.markdown), [props.markdown]);
  return urls.map((url) => <TimelinePullRequestCard key={url} {...props} url={url} />);
});

function TimelinePullRequestCard(props: {
  readonly url: string;
  readonly environmentId: EnvironmentId;
  readonly actions: LinkActions;
  readonly onOpen: (url: string) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects();
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const target = resolvePullRequestPreviewTarget({
    environmentId: props.environmentId,
    projects,
    pullRequestsEnabled: runtime?.serverConfig !== undefined && runtime.serverConfig !== null,
    url: props.url,
  });
  const preview = useEnvironmentQuery(
    target ? composerPullRequests.previewCard(target) : null,
  ).data;
  const parsed = sourceControlClients.parseChangeRequestUrl(props.url)?.link;
  const status = preview ? pullRequestStatus(preview) : null;
  return (
    <Menu
      shouldOpenOnLongPress
      actions={props.actions.actions(props.url)}
      onPressAction={({ nativeEvent }) => props.actions.perform(props.url, nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={preview?.title ?? props.url}
        onPress={() => void props.onOpen(props.url)}
        className="my-2 min-w-0 flex-row gap-3 rounded-xl border border-border bg-card p-3 active:opacity-70"
      >
        <SymbolView
          name={status?.icon ?? PullRequestGlyph.pullRequest}
          size={20}
          tintColorClassName={status?.tint ?? "accent-icon-muted"}
        />
        <View className="min-w-0 flex-1 gap-1">
          <AppText className="text-xs text-foreground-secondary" numberOfLines={1}>
            {parsed?.repository} #{parsed?.number}
            {status ? ` · ${status.label}` : ""}
          </AppText>
          <AppText className="font-t3-medium text-sm text-foreground" numberOfLines={2}>
            {preview?.title ?? props.url}
          </AppText>
          {preview?.author ? (
            <View className="flex-row items-center gap-1">
              <PullRequestAvatar actor={preview.author} size={16} />
              <AppText className="text-xs text-foreground-secondary">
                {preview.author.name ?? preview.author.login}
              </AppText>
            </View>
          ) : null}
        </View>
        {props.actions.actions(props.url).length ? (
          <Menu
            actions={props.actions.actions(props.url)}
            onPressAction={({ nativeEvent }) => props.actions.perform(props.url, nativeEvent.event)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translator.message("mobile.timeline.messageActions")}
              className="size-11 items-center justify-center"
            >
              <SymbolView name="ellipsis" size={16} />
            </Pressable>
          </Menu>
        ) : null}
      </Pressable>
    </Menu>
  );
}
