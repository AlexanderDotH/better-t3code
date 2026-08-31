import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { resolveSettingsSectionLabels } from "./settingsSearch";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const translate = useInterfaceTranslator().message;
  const sectionLabels = resolveSettingsSectionLabels(translate);
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const sectionLabel =
    normalizedPathname === "/settings/diagnostics"
      ? translate("settings.application.section.diagnostics")
      : (sectionLabels[normalizedPathname as keyof typeof sectionLabels] ?? null);

  return (
    <WorkspaceBreadcrumb ariaLabel={translate("settings.breadcrumb.aria")}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{translate("settings.breadcrumb.root")}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? translate("settings.breadcrumb.root")}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
