import type { ContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { contextMeterPresentation } from "./context-meter-presentation";
import { ThreadDetailSheet } from "./ThreadDetailSheet";
import { ThreadContextMeterRing } from "./ThreadContextMeterRing";
import { Button } from "../../components/ui/Button";

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
  readonly snapshot: ContextWindowSnapshot;
  readonly onCompact?: () => void;
  readonly compactDisabledReason?: string | null;
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
      {props.snapshot.totalProcessedTokens != null ? (
        <DetailRow
          label={translator.message("chat.contextMeter.processed")}
          value={translator.number(props.snapshot.totalProcessedTokens)}
        />
      ) : null}
      {props.snapshot.cost ? (
        <DetailRow
          label={translator.message("mobile.composer.cost")}
          value={`${props.snapshot.cost.currency} ${translator.number(props.snapshot.cost.amount, { minimumFractionDigits: Math.abs(props.snapshot.cost.amount) > 0 && Math.abs(props.snapshot.cost.amount) < 0.01 ? 4 : 2, maximumFractionDigits: 4 })}`}
        />
      ) : null}
      {props.snapshot.compactsAutomatically ? (
        <Text className="py-2 text-sm text-foreground-muted">
          {props.snapshot.autoCompactThreshold
            ? translator.message("mobile.composer.autoCompactThreshold", {
                tokens: translator.number(props.snapshot.autoCompactThreshold),
              })
            : translator.message("chat.contextMeter.autoCompact")}
        </Text>
      ) : null}
      {props.onCompact ? (
        <Button
          label={translator.message("chat.contextMeter.compact")}
          disabled={Boolean(props.compactDisabledReason)}
          onPress={() => {
            props.onClose();
            props.onCompact?.();
          }}
        />
      ) : null}
      {props.compactDisabledReason ? (
        <Text className="py-2 text-xs text-foreground-muted">{props.compactDisabledReason}</Text>
      ) : null}
    </ThreadDetailSheet>
  );
}

export const ThreadContextMeter = memo(function ThreadContextMeter(props: {
  readonly snapshot: ContextWindowSnapshot;
  readonly onCompact?: () => void;
  readonly compactDisabledReason?: string | null;
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
        <ContextDetailSheet
          presentation={presentation}
          snapshot={props.snapshot}
          onCompact={props.onCompact}
          compactDisabledReason={props.compactDisabledReason}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
    </>
  );
});
