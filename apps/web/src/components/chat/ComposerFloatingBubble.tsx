import type { Ref } from "react";

import "./ComposerFloatingBubble.css";

export function ComposerFloatingBubble(props: {
  readonly active: boolean;
  readonly hostRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      aria-hidden={props.active ? undefined : true}
      className="composer-floating-bubble-region"
      data-chat-composer-floating-bubble="true"
      hidden={!props.active}
      inert={!props.active}
    >
      <div
        ref={props.hostRef}
        className="composer-floating-bubble-host"
        data-chat-composer-floating-bubble-host="true"
      />
    </div>
  );
}
