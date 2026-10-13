import {
  normalizeVisualizationAppearance,
  resolveVisualizationAppearance,
} from "@t3tools/client-runtime/visualizations/appearance";
import type {
  VisualizationAppearance,
  VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";
import { useMemo, useSyncExternalStore } from "react";

export const VISUALIZATION_SURFACE_CLASS_NAME =
  "chat-markdown-codeblock border border-border/70 bg-secondary dark:border-transparent dark:bg-input/32";

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
let snapshot: VisualizationAppearance | undefined;
let snapshotKey = "";
let snapshotRoot: HTMLElement | undefined;
let probe:
  | { container: HTMLDivElement; surface: HTMLDivElement; token: HTMLDivElement }
  | undefined;

function createAppearanceProbe() {
  const container = document.createElement("div");
  container.className = "chat-markdown";
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  const surface = document.createElement("div");
  surface.className = VISUALIZATION_SURFACE_CLASS_NAME;
  const token = document.createElement("div");
  token.style.cssText =
    "background-color:var(--background);color:var(--contrast-foreground);border-color:var(--contrast-border);font-family:var(--font-sans)";
  container.append(surface, token);
  document.body.append(container);
  return { container, surface, token };
}

function readVisualizationAppearance(): VisualizationAppearance | undefined {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  if (!root || !document.body || typeof getComputedStyle === "undefined") return undefined;
  probe ??= createAppearanceProbe();
  const theme = root.classList.contains("dark") ? "dark" : "light";
  const defaults = resolveVisualizationAppearance(theme);
  const tokenStyle = getComputedStyle(probe.token);
  const colors = {
    fontFamily: tokenStyle.fontFamily || defaults.fontFamily,
    background: tokenStyle.backgroundColor || defaults.background,
    foreground: tokenStyle.color || defaults.foreground,
    border: tokenStyle.borderTopColor || defaults.border,
  };
  const cardBackground = getComputedStyle(probe.surface).backgroundColor;
  probe.token.style.color = "var(--contrast-muted-foreground)";
  probe.token.style.backgroundColor = "var(--muted)";
  const mutedStyle = getComputedStyle(probe.token);
  const mutedForeground = mutedStyle.color || defaults.mutedForeground;
  const surface = mutedStyle.backgroundColor || defaults.surface;
  probe.token.style.color = "var(--contrast-foreground)";
  probe.token.style.backgroundColor = "var(--background)";

  const card = normalizeVisualizationAppearance(
    { ...colors, mutedForeground, surface: cardBackground || defaults.background },
    theme,
  );
  return normalizeVisualizationAppearance(
    { ...colors, background: card.surface, mutedForeground, surface },
    theme,
  );
}

function refreshAppearance() {
  const next = readVisualizationAppearance();
  const nextKey = JSON.stringify(next) ?? "";
  if (nextKey === snapshotKey) return false;
  snapshot = next;
  snapshotKey = nextKey;
  return true;
}

function getSnapshot() {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  if (root !== snapshotRoot) {
    probe?.container.remove();
    probe = undefined;
    snapshotRoot = root;
    refreshAppearance();
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  if (!observer && root && typeof MutationObserver !== "undefined") {
    // Root palette, contrast, and font mutations share one resolver across all cards.
    observer = new MutationObserver(() => {
      if (refreshAppearance()) for (const notify of listeners) notify();
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-id"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    observer?.disconnect();
    observer = undefined;
    probe?.container.remove();
    probe = undefined;
    snapshotRoot = undefined;
    snapshot = undefined;
    snapshotKey = "";
  };
}

function getServerSnapshot() {
  return undefined;
}

export function useVisualizationAppearance(theme: VisualizationRenderRequest["theme"]) {
  const appearance = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => appearance ?? resolveVisualizationAppearance(theme), [appearance, theme]);
}
