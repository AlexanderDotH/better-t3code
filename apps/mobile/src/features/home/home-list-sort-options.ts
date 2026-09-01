import type { SidebarThreadSortOrder } from "@t3tools/contracts";

import type { HomeProjectSortOrder } from "./homeThreadList";

export const PROJECT_SORT_OPTIONS: ReadonlyArray<{
  readonly value: HomeProjectSortOrder;
  readonly label: string;
}> = [
  { value: "updated_at", label: "Last user message" },
  { value: "created_at", label: "Created at" },
];

export const THREAD_SORT_OPTIONS: ReadonlyArray<{
  readonly value: SidebarThreadSortOrder;
  readonly label: string;
}> = [
  { value: "updated_at", label: "Last user message" },
  { value: "created_at", label: "Created at" },
];
