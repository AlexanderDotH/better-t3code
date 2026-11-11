import { BETTER_T3_SETTINGS_CATEGORY_IDS } from "@t3tools/client-runtime/better-t3-settings-layout";
import { useLocation } from "@tanstack/react-router";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
  "/settings/open-source-licenses": "Open source licenses",
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_BREADCRUMB_LABELS[normalizedPathname] ?? null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const translate = useInterfaceTranslator().message;
  const sectionLabel = settingsBreadcrumbLabel(pathname);
  const search: { readonly category?: unknown } = useLocation({
    select: (location) => location.search,
  });
  const requestedCategory = search.category;
  const category =
    pathname === "/settings/better-t3"
      ? BETTER_T3_SETTINGS_CATEGORY_IDS.find((id) => id === requestedCategory)
      : undefined;

  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      {category ? (
        <>
          <WorkspaceBreadcrumbItem>{sectionLabel}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current className="truncate">
            {translate(`settings.betterT3.tab.${category}`)}
          </WorkspaceBreadcrumbItem>
        </>
      ) : (
        <WorkspaceBreadcrumbItem current className="truncate">
          {sectionLabel ?? "Settings"}
        </WorkspaceBreadcrumbItem>
      )}
    </WorkspaceBreadcrumb>
  );
}
