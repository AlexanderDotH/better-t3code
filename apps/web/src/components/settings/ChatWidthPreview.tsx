import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { ArrowUpIcon } from "lucide-react";

import {
  DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT,
  resolveChatContentPreviewWidthPercent,
} from "../chat/chatContentWidth";

export function ChatWidthPreview(props: {
  readonly adjustmentPercent: number;
  readonly customizationEnabled: boolean;
  readonly translate: InterfaceTranslator["message"];
  readonly valueLabel: string;
}) {
  const widthPercent = resolveChatContentPreviewWidthPercent(
    props.customizationEnabled,
    props.adjustmentPercent,
  );
  const label = props.translate("settings.betterT3.preview.live");

  return (
    <div
      aria-label={`${label}: ${props.valueLabel}`}
      className="mt-4"
      data-chat-width-preview
      role="img"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">{label}</span>
        <span>{props.translate("settings.betterT3.chatWidth.preview.example")}</span>
      </div>
      <div aria-hidden="true" className="rounded-xl border border-border/60 bg-background/60 p-4">
        <div
          className="mx-auto flex h-4 items-center gap-2 border-x border-border text-[10px] text-muted-foreground"
          style={{ width: `${DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT}%` }}
        >
          <span className="h-px min-w-0 flex-1 bg-border" />
          <span className="text-center leading-tight">
            {props.translate("settings.betterT3.chatWidth.preview.default")}
          </span>
          <span className="h-px min-w-0 flex-1 bg-border" />
        </div>
        <div
          className="mx-auto mt-4 flex min-h-48 min-w-0 flex-col gap-4 text-xs leading-relaxed wrap-anywhere"
          style={{ width: `${widthPercent}%` }}
        >
          <div className="max-w-[85%] self-end rounded-xl bg-muted/70 px-3 py-2 text-foreground">
            {props.translate("settings.betterT3.chatWidth.preview.request")}
          </div>
          <p className="text-foreground/85">
            {props.translate("settings.betterT3.chatWidth.preview.response")}
          </p>
          <div className="mt-auto flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-xs/5">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {props.translate("settings.betterT3.preview.chat.prompt")}
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowUpIcon className="size-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
