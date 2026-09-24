import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const FOCUS_FADE_DISTANCE_PX = 600;
const FOCUS_ITEM_SELECTOR =
  ':scope > h2, [data-slot="settings-section-heading"], [data-slot="settings-section-body"] > *';

function applySectionFocus(content: HTMLElement, activeGroupId: string) {
  const groups = Array.from(content.querySelectorAll<HTMLElement>("[data-better-t3-group]"));
  const activeIndex = groups.findIndex((group) => group.dataset.betterT3Group === activeGroupId);
  const activeBounds = groups[activeIndex]?.getBoundingClientRect();
  if (!activeBounds) return;

  // Measure once when focus or layout changes. Per-row filters avoid capturing an entire section
  // in a backdrop layer every time the page scrolls.
  const measurements = groups.map((group, index) => {
    const candidates = new Set(group.querySelectorAll<HTMLElement>(FOCUS_ITEM_SELECTOR));
    const items = [...candidates].filter((item) => {
      for (
        let parent = item.parentElement;
        parent && parent !== group;
        parent = parent.parentElement
      )
        if (candidates.has(parent)) return false;
      return true;
    });
    return {
      group,
      active: index === activeIndex,
      items: items.map((item) => {
        const bounds = item.getBoundingClientRect();
        const distance =
          index < activeIndex ? activeBounds.top - bounds.bottom : bounds.top - activeBounds.bottom;
        const depth = Math.min(1, Math.max(0, distance) / FOCUS_FADE_DISTANCE_PX);
        return {
          item,
          blur: `${(3 + depth * 5).toFixed(2)}px`,
          opacity: (0.62 - depth * 0.4).toFixed(2),
        };
      }),
    };
  });

  for (const { group, active, items } of measurements) {
    group.dataset.focusActive = String(active);
    for (const { item, blur, opacity } of items) {
      item.dataset.settingsFocusItem = "";
      item.style.setProperty("--settings-focus-blur", active ? "0px" : blur);
      item.style.setProperty("--settings-focus-opacity", active ? "1" : opacity);
    }
  }
}

export function useBetterT3SectionFocus(
  contentRef: RefObject<HTMLDivElement | null>,
  initialGroupId: string,
) {
  const [activeGroup, setActiveGroupState] = useState(initialGroupId);
  const activeGroupRef = useRef(initialGroupId);
  const setActiveGroup = useCallback(
    (id: string) => {
      if (activeGroupRef.current === id) return;
      activeGroupRef.current = id;
      if (contentRef.current) applySectionFocus(contentRef.current, id);
      setActiveGroupState(id);
    },
    [contentRef],
  );

  useEffect(() => {
    const content = contentRef.current;
    const scrollArea = content?.closest<HTMLElement>("[data-settings-page-scroll]");
    const navigation = content?.querySelector<HTMLElement>("[data-better-t3-navigation]");
    if (!content || !scrollArea || !navigation) return;

    const groups = Array.from(content.querySelectorAll<HTMLElement>("[data-better-t3-group]"));
    let frame: number | null = null;
    let layoutChanged = true;
    const updateActiveGroup = () => {
      frame = null;
      const scrollAreaRect = scrollArea.getBoundingClientRect();
      const viewportTop = Math.max(scrollAreaRect.top, navigation.getBoundingClientRect().bottom);
      let nextGroup = activeGroupRef.current;
      let largestVisibleHeight = 0;
      for (const group of groups) {
        const bounds = group.getBoundingClientRect();
        const visibleHeight = Math.max(
          0,
          Math.min(bounds.bottom, scrollAreaRect.bottom) - Math.max(bounds.top, viewportTop),
        );
        const groupId = group.dataset.betterT3Group;
        if (!groupId || visibleHeight === 0) continue;
        if (
          visibleHeight > largestVisibleHeight ||
          (visibleHeight === largestVisibleHeight && groupId === activeGroupRef.current)
        ) {
          largestVisibleHeight = visibleHeight;
          nextGroup = groupId;
        }
      }
      if (nextGroup !== activeGroupRef.current) setActiveGroup(nextGroup);
      else if (layoutChanged) applySectionFocus(content, activeGroupRef.current);
      layoutChanged = false;
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateActiveGroup);
    };
    const onResize = () => {
      layoutChanged = true;
      scheduleUpdate();
    };
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const group = event.target.closest<HTMLElement>("[data-better-t3-group]");
      if (group?.dataset.betterT3Group) setActiveGroup(group.dataset.betterT3Group);
    };

    scrollArea.addEventListener("scroll", scheduleUpdate, { passive: true });
    content.addEventListener("focusin", onFocus);
    window.addEventListener("resize", onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(scrollArea);
    resizeObserver.observe(navigation);
    for (const group of groups) resizeObserver.observe(group);
    scheduleUpdate();

    return () => {
      scrollArea.removeEventListener("scroll", scheduleUpdate);
      content.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [contentRef, setActiveGroup]);

  return { activeGroup, setActiveGroup };
}
