import type { EnvironmentId } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { fileThumbnailKind } from "@t3tools/shared/filePreview";
import { DownloadIcon, EyeIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import type { ChatFileAttachment } from "../../types";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { readAttachmentThumbnail } from "./attachmentThumbnail";
import { useChatSizeMotionEnabled, useChatWidthMotion } from "./ChatSizeMotion";

type FileActions = {
  readonly theme: "light" | "dark";
  readonly onOpen: (file: ChatFileAttachment) => void;
  readonly onDownload: (file: ChatFileAttachment) => void;
};

function AttachmentDownload({
  file,
  onDownload,
}: Pick<FileActions, "onDownload"> & {
  readonly file: ChatFileAttachment;
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost-muted"
      aria-label={`Download ${file.name}`}
      onClick={() => onDownload(file)}
    >
      <DownloadIcon />
    </Button>
  );
}

function AttachmentThumbnail({
  file,
  environmentId,
  theme,
  onOpen,
  onDownload,
  onUnavailable,
}: FileActions & {
  readonly file: ChatFileAttachment;
  readonly environmentId: EnvironmentId;
  readonly onUnavailable: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [content, setContent] = useState<{ url: string; text: string } | null>(null);
  const kind = fileThumbnailKind(file);
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      disposition: "inline" as const,
    }),
    [file.id, file.name, file.mimeType],
  );
  const asset = useAssetUrlState(visible ? environmentId : null, visible ? resource : null);
  const url = asset._tag === "Success" ? asset.url : null;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !url || (kind !== "text" && kind !== "document")) return;
    if (content?.url === url) return;
    const controller = new AbortController();
    void readAttachmentThumbnail(url, kind, controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return;
        if (!text.trim()) onUnavailable(file.id);
        else setContent({ url, text });
      })
      .catch(() => {
        if (!controller.signal.aborted) onUnavailable(file.id);
      });
    return () => controller.abort();
  }, [visible, url, kind, content?.url, file.id, onUnavailable]);

  useEffect(() => {
    if (visible && asset._tag === "Failure") onUnavailable(file.id);
  }, [visible, asset._tag, file.id, onUnavailable]);

  return (
    <div ref={ref} className="better-chat-attachment-card" data-attachment-preview={file.id}>
      <div className="better-chat-attachment-thumbnail" aria-hidden>
        {visible && url && kind === "image" ? (
          <img src={url} alt="" loading="lazy" onError={() => onUnavailable(file.id)} />
        ) : visible && url && kind === "pdf" ? (
          // Chromium's PDF viewer requires an unsandboxed frame, as in the full document viewer.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          <iframe
            src={`${url}#page=1&toolbar=0&navpanes=0&view=FitH`}
            title={file.name}
            tabIndex={-1}
            loading="lazy"
            onError={() => onUnavailable(file.id)}
          />
        ) : content?.url === url && content ? (
          <pre className={kind === "document" ? "better-chat-attachment-page" : undefined}>
            {content.text}
          </pre>
        ) : (
          <div className="better-chat-attachment-placeholder">
            <PierreEntryIcon pathValue={file.name} kind="file" theme={theme} className="size-6" />
          </div>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="better-chat-attachment-open"
              data-chat-media-preview
              aria-label={`Preview ${file.name}`}
              onClick={() => onOpen(file)}
            />
          }
        >
          <span className="better-chat-attachment-caption">
            <PierreEntryIcon pathValue={file.name} kind="file" theme={theme} />
            <span className="min-w-0">
              <span className="block truncate">{file.name}</span>
              <span className="block text-2xs opacity-65">
                {formatAttachmentSize(file.sizeBytes)}
              </span>
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{file.name}</TooltipPopup>
      </Tooltip>
      <div className="better-chat-attachment-download">
        <AttachmentDownload file={file} onDownload={onDownload} />
      </div>
    </div>
  );
}

export function MessageAttachmentFiles({
  files,
  unknownAttachments,
  environmentId,
  theme,
  onOpen,
  onDownload,
}: FileActions & {
  readonly files: readonly ChatFileAttachment[];
  readonly unknownAttachments: ReadonlyArray<{ id: string; name: string }>;
  readonly environmentId: EnvironmentId;
}) {
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set());
  const onUnavailable = useCallback((id: string) => {
    setUnavailable((current) => (current.has(id) ? current : new Set([...current, id])));
  }, []);
  const previews = files.filter(
    (file) =>
      file.downloadable !== false && fileThumbnailKind(file) !== null && !unavailable.has(file.id),
  );
  const previewIds = new Set(previews.map((file) => file.id));
  const otherFiles = files.filter((file) => !previewIds.has(file.id));
  const motion = useChatSizeMotionEnabled();
  const widthRef = useChatWidthMotion<HTMLDivElement>(
    JSON.stringify([files.map((file) => file.id), [...previewIds]]),
    motion,
  );
  if (files.length === 0 && unknownAttachments.length === 0) return null;
  return (
    <div ref={widthRef} className="better-chat-attachment-files">
      {previews.length > 0 ? (
        <div className="better-chat-attachment-grid">
          {previews.map((file) => (
            <AttachmentThumbnail
              key={file.id}
              file={file}
              environmentId={environmentId}
              theme={theme}
              onOpen={onOpen}
              onDownload={onDownload}
              onUnavailable={onUnavailable}
            />
          ))}
        </div>
      ) : null}
      {otherFiles.length > 0 || unknownAttachments.length > 0 ? (
        <div className="better-chat-attachment-list">
          {otherFiles.map((file) => (
            <div key={file.id} className="better-chat-attachment-file">
              {file.downloadable !== false ? (
                <>
                  <button
                    type="button"
                    onClick={() => onOpen(file)}
                    aria-label={`Preview ${file.name}`}
                  >
                    <PierreEntryIcon pathValue={file.name} kind="file" theme={theme} />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <EyeIcon className="size-3.5 shrink-0 opacity-60" />
                  </button>
                  <AttachmentDownload file={file} onDownload={onDownload} />
                </>
              ) : (
                <>
                  <PierreEntryIcon pathValue={file.name} kind="file" theme={theme} />
                  <span className="min-w-0 truncate">{file.name}</span>
                </>
              )}
            </div>
          ))}
          {unknownAttachments.map((file) => (
            <div key={file.id} className="better-chat-attachment-file">
              <PierreEntryIcon pathValue={file.name} kind="file" theme={theme} />
              <span className="min-w-0 truncate">{file.name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
