import LegacyThreadSidebar from "./LegacySidebar";
import ThreadSidebar from "./Sidebar";

export type ThreadSidebarLayout = "current" | "classic";

export function resolveThreadSidebarLayout(legacySidebarEnabled: boolean): ThreadSidebarLayout {
  return legacySidebarEnabled ? "classic" : "current";
}

export function ThreadSidebarSelection({ layout }: { layout: ThreadSidebarLayout }) {
  if (layout === "classic") {
    return <LegacyThreadSidebar />;
  }

  return <ThreadSidebar />;
}
