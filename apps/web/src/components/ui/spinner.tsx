import { Loader2Icon } from "lucide-react";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof Loader2Icon>) {
  const translator = useInterfaceTranslator();
  return (
    <Loader2Icon
      aria-label={translator.message("ui.loading")}
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
