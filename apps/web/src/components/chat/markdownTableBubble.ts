interface TableBounds {
  readonly left: number;
  readonly right: number;
}

const expandedTables = new WeakMap<HTMLElement, Map<HTMLElement, TableBounds>>();

export function markdownTableBubblePadding(bubble: HTMLElement): number {
  const style = getComputedStyle(bubble);
  return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
}

/** Grow only the painted surface so table measurement retains its normal text width. */
export function observeMarkdownTableBubble(table: HTMLElement, bubble: HTMLElement): () => void {
  let tables = expandedTables.get(bubble);
  if (!tables) {
    tables = new Map();
    expandedTables.set(bubble, tables);
  }
  const group = tables;
  let active = true;
  const publish = () => {
    if (group.size === 0) {
      bubble.removeAttribute("data-expanded-table");
      bubble.style.removeProperty("--chat-table-surface-left");
      bubble.style.removeProperty("--chat-table-surface-width");
      expandedTables.delete(bubble);
      return;
    }
    let left = 0;
    let right = bubble.getBoundingClientRect().width;
    for (const bounds of group.values()) {
      left = Math.min(left, bounds.left);
      right = Math.max(right, bounds.right);
    }
    bubble.setAttribute("data-expanded-table", "true");
    bubble.style.setProperty("--chat-table-surface-left", `${left}px`);
    bubble.style.setProperty("--chat-table-surface-width", `${right - left}px`);
  };
  const measure = () => {
    if (!active) return;
    const bubbleBounds = bubble.getBoundingClientRect();
    const tableBounds = table.getBoundingClientRect();
    const style = getComputedStyle(bubble);
    group.set(table, {
      left: tableBounds.left - bubbleBounds.left - (Number.parseFloat(style.paddingLeft) || 0),
      right: tableBounds.right - bubbleBounds.left + (Number.parseFloat(style.paddingRight) || 0),
    });
    publish();
  };
  measure();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  observer?.observe(table);
  observer?.observe(bubble);
  return () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    group.delete(table);
    publish();
  };
}
