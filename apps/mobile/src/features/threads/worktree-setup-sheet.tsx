import type { ReactElement } from "react";
import { Sheet } from "../../components/ui/Sheet";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export interface WorktreeSetupSheetProps {
  children: ReactElement;
  height: number;
  onClose: () => void;
}

export function WorktreeSetupSheet({ children, onClose }: WorktreeSetupSheetProps) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Sheet title={translator.message("mobile.ui.worktreeSetup")} onClose={onClose}>
      {children}
    </Sheet>
  );
}
