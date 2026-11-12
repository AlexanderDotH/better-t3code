import { Pressable } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { dispatchHardwareKeyboardCommand } from "./hardwareKeyboardCommands";

export function CommandPaletteButton() {
  const translator = useMobileInterfaceTranslator();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={translator.message("mobile.home.commandPalette")}
      className="min-h-11 min-w-11 items-center justify-center"
      onPress={() => dispatchHardwareKeyboardCommand("commandPalette")}
    >
      <SymbolView name="keyboard" size={18} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}
