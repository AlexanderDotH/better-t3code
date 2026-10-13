import { useRef } from "react";
import { View } from "react-native";
import type { VisualizationRenderRequest } from "@t3tools/client-runtime/visualizations/model";

import { VisualizationRuntime, type VisualizationRuntimeHandle } from "./VisualizationRuntime";

/** Keeps inline PNG rendering alive only for the requested export. */
export function VisualizationPngExport({
  request,
  onPng,
  onError,
}: {
  request: VisualizationRenderRequest;
  onPng: (dataUrl: string) => void;
  onError: (error: string) => void;
}) {
  const runtime = useRef<VisualizationRuntimeHandle>(null);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: -10000, width: 1000, height: 720, opacity: 0 }}
    >
      <VisualizationRuntime
        ref={runtime}
        request={request}
        onResult={() => runtime.current?.exportPng()}
        onPng={onPng}
        onError={onError}
        onExportError={onError}
      />
    </View>
  );
}
