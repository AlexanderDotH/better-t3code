import type { SnapShotSource } from "@t3tools/contracts";
import { snapShotAccessibilityDetails } from "@t3tools/shared/snapShot";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function MessageImageCard({
  name,
  source,
  children,
}: {
  readonly name: string;
  readonly source?: SnapShotSource | undefined;
  readonly children: ReactNode;
}) {
  const translate = useMobileInterfaceTranslator().message;
  const [expanded, setExpanded] = useState(false);
  const gradientId = useId();
  const accessibility = useMemo(
    () => (expanded && source ? snapShotAccessibilityDetails(source) : undefined),
    [expanded, source],
  );

  if (!source) {
    return (
      <View className="min-w-0 overflow-hidden rounded-2xl bg-card">
        {children}
        <Text className="px-3 py-2.5 text-xs text-foreground-muted" numberOfLines={1}>
          {name}
        </Text>
      </View>
    );
  }

  return (
    <View className="min-w-0">
      <View className="overflow-hidden rounded-[20px] bg-card">
        {children}
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 bottom-0 flex-row items-end gap-2.5 px-3 pb-3 pt-9"
        >
          <Svg width="100%" height="100%" pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="black" stopOpacity="0" />
                <Stop offset="1" stopColor="black" stopOpacity="0.85" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
          {source.appIconDataUrl ? (
            <Image
              source={{ uri: source.appIconDataUrl }}
              className="size-7 rounded-lg"
              accessible={false}
            />
          ) : (
            <View className="size-7 items-center justify-center rounded-lg bg-white/20">
              <Text className="font-t3-bold text-xs text-white">{source.appName.slice(0, 1)}</Text>
            </View>
          )}
          <View className="min-w-0 flex-1 gap-1" pointerEvents="none">
            <Text className="font-t3-bold text-sm text-white" numberOfLines={1}>
              {source.appName}
            </Text>
            <Text className="text-xs text-white/85" numberOfLines={1}>
              {source.windowTitle || translate("chat.attachments.capturedWindow")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={translate("chat.attachments.captureAccessibility")}
            onPress={() => setExpanded((value) => !value)}
            className="min-h-11 justify-center rounded-full bg-white/20 px-3 active:bg-white/30"
          >
            <Text className="text-xs text-white">{translate("chat.attachments.contents")}</Text>
          </Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row items-center justify-between gap-2 px-2 py-3"
      >
        <Text className="min-w-0 flex-1 text-xs text-user-bubble-foreground">
          {translate("chat.attachments.captureAccessibility")}
        </Text>
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-user-bubble-foreground"
        />
      </Pressable>
      {expanded ? (
        <ScrollView className="max-h-64 rounded-xl bg-card p-3" nestedScrollEnabled>
          <Text selectable className="font-mono text-xs text-foreground">
            {accessibility?.content ?? translate("chat.attachments.noAccessibility")}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
