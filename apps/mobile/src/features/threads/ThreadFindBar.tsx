import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { findMatchLineOffset, findTextMatches } from "../../lib/threadFind";

export function ThreadFindBar(props: {
  readonly query: string;
  readonly count: number;
  readonly index: number;
  readonly loading: boolean;
  readonly error?: string | null;
  readonly onChange: (query: string) => void;
  readonly onNavigate: (direction: 1 | -1) => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-1 border-b border-border bg-screen px-3 py-2">
      <View className="flex-row items-center gap-1">
        <TextInput
          autoFocus
          accessibilityLabel={translator.message("mobile.timeline.find")}
          placeholder={translator.message("mobile.timeline.findPlaceholder")}
          value={props.query}
          onChangeText={props.onChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => props.onNavigate(1)}
          className="min-h-11 min-w-0 flex-1 rounded-lg bg-input px-3 text-base text-foreground"
        />
        <AppText accessibilityLiveRegion="polite" className="text-xs text-foreground-secondary">
          {translator.message("mobile.timeline.findCount", {
            current: props.index + 1,
            count: props.count,
          })}
          {props.loading ? "…" : ""}
        </AppText>
        {([-1, 1] as const).map((direction) => (
          <Pressable
            key={direction}
            accessibilityRole="button"
            accessibilityLabel={translator.message(
              direction === -1 ? "mobile.timeline.findPrevious" : "mobile.timeline.findNext",
            )}
            accessibilityState={{ disabled: props.count === 0 }}
            disabled={props.count === 0}
            className="size-11 items-center justify-center"
            onPress={() => props.onNavigate(direction)}
          >
            <SymbolView name={direction === -1 ? "chevron.up" : "chevron.down"} size={18} />
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translator.message("mobile.timeline.closeFind")}
          onPress={props.onClose}
          className="size-11 items-center justify-center"
        >
          <SymbolView name="xmark" size={18} />
        </Pressable>
      </View>
      {props.error ? (
        <AppText className="text-xs text-adaptive-rose-600-400">{props.error}</AppText>
      ) : null}
    </View>
  );
}

export function ThreadFindText(props: {
  readonly text: string;
  readonly query: string;
  readonly activeStart?: number;
  readonly onActiveLine?: (offset: number) => void;
}) {
  const matches = findTextMatches(props.text, props.query);
  return (
    <AppText
      selectable
      className="text-base leading-6 text-foreground"
      onTextLayout={
        props.activeStart === undefined
          ? undefined
          : (event) => {
              const offset = findMatchLineOffset(
                props.text,
                props.activeStart!,
                event.nativeEvent.lines,
              );
              if (offset !== null) props.onActiveLine?.(offset);
            }
      }
    >
      {matches.flatMap((match, index) => {
        const before = props.text.slice(matches[index - 1]?.end ?? 0, match.start);
        return [
          before,
          <AppText
            key={match.start}
            style={{
              backgroundColor: match.start === props.activeStart ? "#fb923c" : "#fde047",
              color: "#171717",
            }}
          >
            {props.text.slice(match.start, match.end)}
          </AppText>,
        ];
      })}
      {props.text.slice(matches.at(-1)?.end ?? 0)}
    </AppText>
  );
}
