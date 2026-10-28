import { ChevronRightIcon, ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { ChatImageAttachment } from "../../types";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SnapShotAccessibilityData,
  SnapShotAttachmentDetails,
  snapShotAccessibilityDetails,
} from "./SnapShotAttachmentDetails";

export function MessageImageAttachment({
  image,
  onOpen,
}: {
  readonly image: ChatImageAttachment;
  readonly onOpen: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const source = image.source?.kind === "snap-shot" ? image.source : undefined;
  const accessibility = useMemo(
    () => (accessibilityOpen && source ? snapShotAccessibilityDetails(source) : undefined),
    [accessibilityOpen, source],
  );
  const preview = (
    <button
      type="button"
      className="better-chat-image-open"
      data-chat-media-preview
      aria-label={translate("chat.attachments.preview", { name: image.name })}
      disabled={!image.previewUrl}
      onClick={onOpen}
    >
      {image.previewUrl ? (
        <img src={image.previewUrl} alt={image.name} loading="lazy" decoding="async" />
      ) : (
        <ImageIcon className="size-8 opacity-50" aria-hidden />
      )}
    </button>
  );

  if (!source) {
    return (
      <div className="better-chat-attachment-card better-chat-image-card">
        {preview}
        <Tooltip>
          <TooltipTrigger render={<div className="better-chat-image-caption" />}>
            {image.name}
          </TooltipTrigger>
          <TooltipPopup>{image.name}</TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="better-chat-capture">
      <div className="better-chat-capture-preview">
        {preview}
        <SnapShotAttachmentDetails source={source} appearance="message" />
      </div>
      <details
        className="better-chat-capture-accessibility"
        onToggle={(event) => setAccessibilityOpen(event.currentTarget.open)}
      >
        <summary>
          {translate("chat.attachments.captureAccessibility")}
          <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
        </summary>
        {accessibilityOpen ? (
          accessibility ? (
            <SnapShotAccessibilityData
              details={accessibility}
              className="better-chat-capture-accessibility-content"
            />
          ) : (
            <p className="better-chat-capture-accessibility-content">
              {translate("chat.attachments.noAccessibility")}
            </p>
          )
        ) : null}
      </details>
    </div>
  );
}
