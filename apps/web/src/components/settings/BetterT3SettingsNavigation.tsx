import type { InterfaceMessageKey, InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import type { RefObject } from "react";

import { BetterT3SettingsSearch } from "./BetterT3SettingsSearch";
import { scrollToSettingsTarget } from "./settingsLayout";
import { useBetterT3SectionFocus } from "./useBetterT3SectionFocus";

function measureNavigation(navigation: HTMLDivElement | null) {
  const content = navigation?.parentElement;
  if (!navigation || !content) return;
  const measure = () =>
    content.style.setProperty("--better-t3-navigation-height", `${navigation.offsetHeight}px`);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(navigation);
  return () => {
    observer.disconnect();
    content.style.removeProperty("--better-t3-navigation-height");
  };
}

export function BetterT3SettingsNavigation({
  contentRef,
  groups,
  translate,
}: {
  readonly contentRef: RefObject<HTMLDivElement | null>;
  readonly groups: ReadonlyArray<{
    readonly id: string;
    readonly labelMessageId: InterfaceMessageKey;
  }>;
  readonly translate: InterfaceTranslator["message"];
}) {
  const { activeGroup, setActiveGroup } = useBetterT3SectionFocus(contentRef, "general");

  return (
    <div
      ref={measureNavigation}
      className="sticky top-0 z-20 pt-[var(--workspace-titlebar-scroll-fade-height)] pb-3"
      data-better-t3-navigation
    >
      <div className="better-t3-settings-navigation min-w-0 overflow-hidden rounded-2xl border border-border/60 p-1.5">
        <div className="p-1 pb-2">
          <BetterT3SettingsSearch />
        </div>
        <nav
          aria-label={translate("settings.betterT3.title")}
          className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-1 border-t border-border/40 pt-1.5"
        >
          {groups.map((group) => (
            <a
              aria-current={group.id === activeGroup ? "location" : undefined}
              className={`inline-flex min-h-9 min-w-0 items-center justify-center rounded-lg px-3 py-1.5 text-center text-sm wrap-anywhere outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:min-h-11 ${
                group.id === activeGroup
                  ? "bg-foreground/8 font-medium text-foreground shadow-xs/10"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
              href={`#better-t3-group-${group.id}`}
              key={group.id}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                setActiveGroup(group.id);
                scrollToSettingsTarget(`better-t3-group-${group.id}`, {
                  highlight: false,
                  behavior: "auto",
                });
              }}
            >
              {translate(group.labelMessageId)}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
