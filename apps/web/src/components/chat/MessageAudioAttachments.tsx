import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "../../assets/assetUrls";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { cn } from "../../lib/utils";
import type { ChatAudioAttachment } from "../../types";
import { Button } from "../ui/button";

function MessageAudioAttachment({
  environmentId,
  attachment,
}: {
  readonly environmentId: EnvironmentId;
  readonly attachment: ChatAudioAttachment;
}) {
  const translate = useInterfaceTranslator().message;
  const resource = useMemo<AssetResource>(
    () => ({
      _tag: "attachment",
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: attachment.mimeType,
    }),
    [attachment.id, attachment.name, attachment.mimeType],
  );
  const assetUrl = useAssetUrlState(environmentId, resource);
  const refreshAssetUrl = useAssetUrlRefresh(environmentId, resource);
  const latestSrc = assetUrl._tag === "Success" ? assetUrl.url : (attachment.previewUrl ?? null);
  const [playbackSrc, setPlaybackSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const src = playbackSrc ?? latestSrc;
  const failed = src !== null ? failedSrc === src : assetUrl._tag === "Failure";

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refreshAssetUrl();
      setPlaybackSrc(null);
      setFailedSrc(null);
    } catch {
      setFailedSrc(src);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/80 bg-background/70 px-3 py-2">
      <div className="mb-1 truncate text-secondary-label text-xs">{attachment.name}</div>
      {failed ? (
        <div role="alert" className="flex items-center gap-2 text-secondary-label text-xs">
          {translate("chat.timeline.audioUnavailable")}
          <Button size="xs" variant="ghost" disabled={retrying} onClick={() => void retry()}>
            {translate("common.retry")}
          </Button>
        </div>
      ) : src !== null ? (
        <audio
          controls
          preload="none"
          src={src}
          aria-label={attachment.name}
          className="h-9 w-full max-w-[420px]"
          onPlay={() => setPlaybackSrc(src)}
          onError={() => {
            if (latestSrc !== null && src !== latestSrc) setPlaybackSrc(null);
            else setFailedSrc(src);
          }}
        />
      ) : (
        <div role="status" className="text-secondary-label text-xs">
          {translate("common.loading")}
        </div>
      )}
    </div>
  );
}

export function MessageAudioAttachments({
  environmentId,
  attachments,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ChatAudioAttachment>;
  readonly className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={cn("flex min-w-64 flex-col gap-2", className)}>
      {attachments.map((attachment) => (
        <MessageAudioAttachment
          key={`${environmentId}:${attachment.id}`}
          environmentId={environmentId}
          attachment={attachment}
        />
      ))}
    </div>
  );
}
