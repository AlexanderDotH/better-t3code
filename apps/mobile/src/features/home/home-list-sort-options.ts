import type { SidebarThreadSortOrder } from "@t3tools/contracts";

import type { HomeProjectSortOrder } from "./homeThreadList";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export const PROJECT_SORT_OPTIONS: ReadonlyArray<{
  readonly value: HomeProjectSortOrder;
  readonly label: string;
}> = [
  {
    value: "manual",
    get label() {
      return currentInterfaceTranslator().message("sidebar.sort.manual");
    },
  },
  {
    value: "updated_at",
    get label() {
      return currentInterfaceTranslator().message("mobile.navigation.lastUserMessage");
    },
  },
  {
    value: "created_at",
    get label() {
      return currentInterfaceTranslator().message("mobile.navigation.createdAt");
    },
  },
];

export const THREAD_SORT_OPTIONS: ReadonlyArray<{
  readonly value: SidebarThreadSortOrder;
  readonly label: string;
}> = [
  {
    value: "updated_at",
    get label() {
      return currentInterfaceTranslator().message("mobile.navigation.lastUserMessage");
    },
  },
  {
    value: "created_at",
    get label() {
      return currentInterfaceTranslator().message("mobile.navigation.createdAt");
    },
  },
];
