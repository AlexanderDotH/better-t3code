import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Badge } from "../ui/badge";

export function ProviderDriverBadge({ label }: { readonly label: string }) {
  const translator = useInterfaceTranslator();
  return (
    <Badge variant="warning" size="sm" className="shrink-0">
      {label === "Early Access"
        ? translator.message("settings.providers.badge.earlyAccess")
        : label}
    </Badge>
  );
}
