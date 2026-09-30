import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

/** Inline trace control; disclosure rows reserve ordinary taps for their own navigation. */
export function ConnectionTraceId({
  traceId,
  tone = "muted",
  activation = "press",
}: {
  readonly traceId: string;
  readonly tone?: "muted" | "danger";
  readonly activation?: "press" | "longPress";
}) {
  const translator = useMobileInterfaceTranslator();
  const copy = () => copyTextWithHaptic(traceId, { target: "connection-trace-id" });
  return (
    <>
      {translator.message("mobile.connection.traceId")}
      <Text
        accessibilityHint={
          activation === "longPress"
            ? translator.message("mobile.connection.copyTraceLongPressHint")
            : translator.message("mobile.connection.copyTraceHint")
        }
        accessibilityLabel={translator.message("mobile.connection.copyTraceWithId", { traceId })}
        accessibilityRole="button"
        accessibilityActions={[
          { name: "activate", label: translator.message("mobile.connection.copyTrace") },
        ]}
        onAccessibilityAction={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.actionName === "activate") copy();
        }}
        className={cn(
          "underline decoration-dotted",
          tone === "danger" ? "text-danger-foreground" : "text-foreground-muted",
        )}
        onLongPress={
          activation === "longPress"
            ? (event) => {
                event.stopPropagation();
                copy();
              }
            : undefined
        }
        onPress={(event) => {
          event.stopPropagation();
          if (activation === "press") copy();
        }}
      >
        {traceId}
      </Text>
    </>
  );
}
