import { memo } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ComposerBanner } from "./ComposerBanner";

export const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
  planTitle,
}: {
  planTitle: string | null;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <ComposerBanner.Row>
      <ComposerBanner.Icon />
      <ComposerBanner.Content>
        <span className="shrink-0 font-medium text-muted-foreground">
          {translate("chat.composer.planReady")}
        </span>
        {planTitle ? (
          <span className="min-w-0 flex-1 truncate text-foreground/85">{planTitle}</span>
        ) : null}
      </ComposerBanner.Content>
    </ComposerBanner.Row>
  );
});
