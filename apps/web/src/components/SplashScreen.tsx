import { useInterfaceTranslator } from "../hooks/useInterfaceTranslator";

export function SplashScreen() {
  const translator = useInterfaceTranslator();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={translator.message("webShell.splash.accessibilityLabel")}
      >
        <img alt="T3 Code" className="size-16 object-contain" src="/apple-touch-icon.png" />
      </div>
    </div>
  );
}
