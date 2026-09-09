import type { Ref } from "react";
import { useBetterT3DeviceFeature } from "~/hooks/useBetterT3Feature";

import "./ComposerFloatingBubble.css";

export function ComposerFloatingBubble({
  active,
  hostRef,
}: {
  readonly active: boolean;
  readonly hostRef: Ref<HTMLDivElement>;
}) {
  const hideDivider = useBetterT3DeviceFeature("chat.hideComposerDivider");
  return (
    <div
      aria-hidden={active ? undefined : true}
      className="composer-floating-bubble-region"
      data-chat-composer-floating-bubble="true"
      data-hide-empty={hideDivider || undefined}
      inert={!active}
    >
      <div
        ref={hostRef}
        className="composer-floating-bubble-host"
        data-chat-composer-floating-bubble-host="true"
      />
    </div>
  );
}
