import { ExternalLinkIcon, GitPullRequestIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "../ui/button";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";

export function PullRequestsUnavailableState({
  title,
  error,
  onRetry,
  gitHubUrl,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
  gitHubUrl?: string;
}) {
  const translate = useInterfaceTranslator().message;
  const resolvedTitle = title ?? translate("pullRequest.unavailable.load");
  return (
    <Empty className="px-4 py-16 md:px-4">
      <EmptyMedia variant="icon">
        <GitPullRequestIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{resolvedTitle}</EmptyTitle>
        {/* The caller names the fix — update the environment, install gh, sign in — so this
            shows its message rather than trying to infer one from the failure text. */}
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
      {onRetry || gitHubUrl ? (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCwIcon className="size-3.5" />
              {translate("common.retry")}
            </Button>
          ) : null}
          {gitHubUrl ? (
            <Button
              size="sm"
              variant="outline"
              render={<a href={gitHubUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              {translate("pullRequest.openGitHub")}
            </Button>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
