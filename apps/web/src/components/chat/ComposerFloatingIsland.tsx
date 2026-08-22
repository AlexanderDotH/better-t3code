import type { ReactNode, Ref } from "react";

export function ComposerFloatingIsland({
  children,
  portalHostRef,
}: {
  readonly children: ReactNode;
  readonly portalHostRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className="chat-composer-floating-island-region pointer-events-auto relative z-30 mx-auto w-full max-w-3xl"
      data-chat-composer-floating-island-region="true"
    >
      <div className="chat-composer-floating-island" data-chat-composer-floating-island="true">
        {children}
        <div
          ref={portalHostRef}
          className="chat-composer-floating-drawer-host"
          data-chat-composer-floating-drawer-host="true"
        />
      </div>
    </div>
  );
}

export function ComposerFloatingIslandSection({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="chat-composer-floating-island-section"
      data-chat-composer-floating-island-section="true"
    >
      {children}
    </div>
  );
}
