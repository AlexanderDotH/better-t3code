export const RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH = 980;
export const SUBAGENT_DEDICATED_PANE_MIN_WIDTH = 2200;

export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = `(max-width: ${RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH}px)`;
export const SUBAGENT_DEDICATED_PANE_MEDIA_QUERY = `(min-width: ${SUBAGENT_DEDICATED_PANE_MIN_WIDTH}px)`;

export type SubagentPresentationMode = "hidden" | "right-panel" | "dedicated-pane";

export function resolveSubagentPresentationMode(viewportWidth: number): SubagentPresentationMode {
  if (viewportWidth <= RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH) {
    return "hidden";
  }
  if (viewportWidth >= SUBAGENT_DEDICATED_PANE_MIN_WIDTH) {
    return "dedicated-pane";
  }
  return "right-panel";
}

export const RIGHT_PANEL_SHEET_CLASS_NAME =
  "w-[min(42vw,28rem)] min-w-80 max-w-[28rem] p-0 max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]";
