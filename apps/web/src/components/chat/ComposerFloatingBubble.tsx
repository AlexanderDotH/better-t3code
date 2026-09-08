import type { Ref } from "react";

import "./ComposerFloatingBubble.css";

export function ComposerFloatingBubble({
  active,
  hostRef,
}: {
  readonly active: boolean;
  readonly hostRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      aria-hidden={active ? undefined : true}
      className="composer-floating-bubble-region"
      data-chat-composer-floating-bubble="true"
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
