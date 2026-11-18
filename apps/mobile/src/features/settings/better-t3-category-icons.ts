import type { BetterT3SettingsCategoryId } from "@t3tools/client-runtime/better-t3-settings-layout";

import type { AppSymbolName } from "../../components/ui/AppSymbol";

export const BETTER_T3_CATEGORY_ICONS: Readonly<Record<BetterT3SettingsCategoryId, AppSymbolName>> =
  {
    general: "gearshape",
    appearance: "paintbrush",
    chat: "bubble.left.and.bubble.right",
    composer: "square.and.pencil",
    sidebar: "sidebar.left",
    usage: "chart.bar.xaxis",
    agents: "person.2",
    workspace: "arrow.triangle.branch",
    voice: "waveform",
    knowledge: "point.3.connected.trianglepath.dotted",
    system: "memorychip",
    integrations: "checkmark.circle",
  };
