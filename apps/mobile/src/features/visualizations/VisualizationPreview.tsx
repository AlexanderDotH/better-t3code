import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { readVisualizationSvgDimensions } from "@t3tools/client-runtime/visualizations/sizing";

const MAX_PREVIEW_HEIGHT = 384;
const FALLBACK_PREVIEW_HEIGHT = 220;

export function VisualizationPreview({
  svg,
  label,
  fullscreenLabel,
  onFullscreen,
  onError,
}: {
  svg: string;
  label: string;
  fullscreenLabel: string;
  onFullscreen: () => void;
  onError: (error: Error) => void;
}) {
  const dimensions = useMemo(() => readVisualizationSvgDimensions(svg), [svg]);
  const [viewportWidth, setViewportWidth] = useState(0);
  const diagram = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${fullscreenLabel}: ${label}`}
      onPress={onFullscreen}
    >
      <SvgXml
        xml={svg}
        width={dimensions?.width ?? "100%"}
        height={dimensions?.height ?? FALLBACK_PREVIEW_HEIGHT}
        accessibilityLabel={label}
        onError={onError}
      />
    </Pressable>
  );
  if (!dimensions) return diagram;
  return (
    <View
      onLayout={({ nativeEvent }) => setViewportWidth(nativeEvent.layout.width)}
      style={{ height: Math.min(dimensions.height, MAX_PREVIEW_HEIGHT) }}
    >
      <ScrollView nestedScrollEnabled>
        <ScrollView
          horizontal
          nestedScrollEnabled
          contentContainerStyle={{ minWidth: viewportWidth, justifyContent: "center" }}
        >
          {diagram}
        </ScrollView>
      </ScrollView>
    </View>
  );
}
