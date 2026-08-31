import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useId, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { serverUpdateStageMessageId } from "../ServerUpdateAction";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

export function prepareComposerServerUpdateCopy({
  state,
  serverLabel,
  translate,
}: {
  readonly state: Exclude<ServerUpdateState, { status: "idle" }>;
  readonly serverLabel: string;
  readonly translate: InterfaceTranslator["message"];
}): Readonly<{ title: string; detail: string }> {
  return {
    title: translate(state.status === "failed" ? "chat.update.failed" : "chat.update.updating", {
      server: serverLabel,
    }),
    detail:
      state.status === "failed"
        ? state.message
        : translate(serverUpdateStageMessageId(state.stage)),
  };
}

/** One text line, clipped at the end so the error detail never squeezes its title. */
export function ComposerServerUpdateStatus({
  state,
  serverLabel,
}: {
  readonly state: Exclude<ServerUpdateState, { status: "idle" }>;
  readonly serverLabel: string;
}) {
  const translator = useInterfaceTranslator();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerId = useId();
  const { title, detail } = prepareComposerServerUpdateCopy({
    state,
    serverLabel,
    translate: translator.message,
  });
  return (
    <span
      role={state.status === "failed" ? "alert" : "status"}
      className="min-w-0"
      data-composer-server-update-status={state.status}
    >
      <Tooltip open={detailsOpen} onOpenChange={setDetailsOpen} triggerId={triggerId}>
        <TooltipTrigger
          id={triggerId}
          closeOnClick={false}
          render={
            <button
              type="button"
              aria-label={`${title}: ${detail}`}
              className="block max-w-full cursor-help truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setDetailsOpen(true)}
            >
              {title}
              <ComposerBanner.Separator />
              <span className="font-normal text-muted-foreground">{detail}</span>
            </button>
          }
        />
        <TooltipPopup side="top" className="max-w-80">
          {title}: {detail}
        </TooltipPopup>
      </Tooltip>
    </span>
  );
}
