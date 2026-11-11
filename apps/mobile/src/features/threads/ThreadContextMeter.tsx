import type { ContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { contextMeterPresentation } from "./context-meter-presentation";
import { ThreadDetailSheet } from "./ThreadDetailSheet";
import { ThreadContextMeterRing } from "./ThreadContextMeterRing";

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <View accessible className="flex-row items-center justify-between gap-4 py-2">
      <Text className="shrink text-sm text-foreground-muted">{props.label}</Text>
      <Text className="shrink text-right text-base font-t3-medium text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

function ContextDetailSheet(props: {
  readonly presentation: ReturnType<typeof contextMeterPresentation>;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <ThreadDetailSheet
      title={translator.message("chat.contextMeter.title")}
      onClose={props.onClose}
    >
      <DetailRow
        label={translator.message("chat.contextMeter.usedTokens")}
        value={props.presentation.usedTokens}
      />
      <DetailRow
        label={translator.message("chat.contextMeter.limit")}
        value={props.presentation.limit}
      />
      <DetailRow
        label={translator.message("chat.contextMeter.percentage")}
        value={props.presentation.percentage}
      />
    </ThreadDetailSheet>
  );
}

export const ThreadContextMeter = memo(function ThreadContextMeter(props: {
  readonly snapshot: ContextWindowSnapshot;
}) {
  const translator = useMobileInterfaceTranslator();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = contextMeterPresentation(props.snapshot, translator);

  return (
    <>
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={presentation.accessibilityLabel}
        onPress={() => setDetailsOpen(true)}
        className="size-11 shrink-0 items-center justify-center active:opacity-60"
      >
        <ThreadContextMeterRing
          fill={presentation.fill}
          critical={presentation.critical}
          unknown={props.snapshot.usedPercentage === null}
        />
      </Pressable>
      {detailsOpen ? (
        <ContextDetailSheet presentation={presentation} onClose={() => setDetailsOpen(false)} />
      ) : null}
    </>
  );
});
