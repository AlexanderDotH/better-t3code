import {
  computeKnowledgeGraphLayout,
  deriveKnowledgeGraphView,
  type KnowledgeGraphPosition,
  type KnowledgeGraphViewport,
} from "@t3tools/client-runtime/knowledge-graph";
import type {
  KnowledgeGraphNodeId,
  KnowledgeGraphNodeKind,
  KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";
import { withUniwind } from "uniwind";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  knowledgeGraphNodeKindMessageKey,
  resolveMobileKnowledgeGraphDragPosition,
  toggleKnowledgeGraphKind,
  type MobileKnowledgeGraphDragGesture,
} from "./mobile-knowledge-graph";

const NODE_WIDTH = 116;
const NODE_HEIGHT = 44;
const MIN_CANVAS_SIZE = 80;
const ThemedSvg = withUniwind(Svg);
const NODE_KINDS = [
  "repository",
  "package",
  "directory",
  "file",
  "symbol",
  "dependency",
  "technology",
  "documentation",
  "architecture",
] as const satisfies ReadonlyArray<KnowledgeGraphNodeKind>;

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

function GraphNode(props: {
  readonly nodeId: KnowledgeGraphNodeId;
  readonly label: string;
  readonly accessibilityHint: string;
  readonly accessibilityLabel: string;
  readonly position: KnowledgeGraphPosition;
  readonly selected: boolean;
  readonly reduceMotion: boolean;
  readonly viewportScale: SharedValue<number>;
  readonly onPress: (nodeId: KnowledgeGraphNodeId) => void;
  readonly onDragEnd: (
    nodeId: KnowledgeGraphNodeId,
    gesture: MobileKnowledgeGraphDragGesture,
  ) => void;
}) {
  const x = useSharedValue(props.position.x);
  const y = useSharedValue(props.position.y);
  const dragStartX = useSharedValue(props.position.x);
  const dragStartY = useSharedValue(props.position.y);

  useEffect(() => {
    cancelAnimation(x);
    cancelAnimation(y);
    if (props.reduceMotion) {
      x.value = props.position.x;
      y.value = props.position.y;
      return undefined;
    }
    x.value = withTiming(props.position.x, { duration: 160 });
    y.value = withTiming(props.position.y, { duration: 160 });
    return () => {
      cancelAnimation(x);
      cancelAnimation(y);
    };
  }, [props.position.x, props.position.y, props.reduceMotion, x, y]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(5)
        .onBegin(() => {
          dragStartX.value = x.value;
          dragStartY.value = y.value;
        })
        .onUpdate((event) => {
          const viewportScale = Math.max(0.5, Math.min(2.5, props.viewportScale.value));
          x.value = dragStartX.value + event.translationX / viewportScale;
          y.value = dragStartY.value + event.translationY / viewportScale;
        })
        .onEnd((event) => {
          runOnJS(props.onDragEnd)(props.nodeId, {
            start: { x: dragStartX.value, y: dragStartY.value },
            translation: { x: event.translationX, y: event.translationY },
            viewportScale: props.viewportScale.value,
          });
        }),
    [dragStartX, dragStartY, props.nodeId, props.onDragEnd, props.viewportScale, x, y],
  );
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - NODE_WIDTH / 2 },
      { translateY: y.value - NODE_HEIGHT / 2 },
    ],
  }));

  return (
    <GestureDetector gesture={drag}>
      <Animated.View
        style={[styles.node, animatedStyle]}
        className={props.selected ? "border-primary bg-primary" : "border-border bg-card"}
      >
        <Pressable
          accessibilityHint={props.accessibilityHint}
          accessibilityLabel={props.accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ selected: props.selected }}
          className="h-full w-full justify-center px-2"
          onPress={() => props.onPress(props.nodeId)}
        >
          <Text
            className={
              props.selected
                ? "text-center text-xs font-t3-semibold text-primary-foreground"
                : "text-center text-xs font-t3-semibold text-foreground"
            }
            numberOfLines={2}
          >
            {props.label}
          </Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

function ZoomButton(props: {
  readonly label: string;
  readonly icon: "minus" | "plus" | "arrow.counterclockwise";
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      className="size-10 items-center justify-center rounded-full border border-border bg-card"
      onPress={props.onPress}
    >
      <SymbolView
        name={props.icon}
        size={17}
        tintColorClassName="accent-foreground"
        type="monochrome"
      />
    </Pressable>
  );
}

export function KnowledgeGraphCanvas(props: {
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly query: string;
  readonly selectedNodeId: KnowledgeGraphNodeId | null;
  readonly onSelectNode: (nodeId: KnowledgeGraphNodeId | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const reduceMotion = useReduceMotion();
  const [dimensions, setDimensions] = useState({ width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE });
  const [kinds, setKinds] = useState<ReadonlySet<KnowledgeGraphNodeKind>>(new Set());
  const [pinned, setPinned] = useState<ReadonlyMap<KnowledgeGraphNodeId, KnowledgeGraphPosition>>(
    new Map(),
  );
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  const view = useMemo(
    () =>
      deriveKnowledgeGraphView({
        snapshot: props.snapshot,
        query: props.query,
        kinds,
        expandedNodeId: props.selectedNodeId,
      }),
    [kinds, props.query, props.selectedNodeId, props.snapshot],
  );
  const layout = useMemo(
    () =>
      computeKnowledgeGraphLayout({
        nodes: view.nodes,
        edges: view.edges,
        width: dimensions.width,
        height: dimensions.height,
        pinned,
        iterations: 28,
      }),
    [dimensions.height, dimensions.width, pinned, view.edges, view.nodes],
  );
  const boundedLayout = useMemo(
    () =>
      new Map(
        [...layout].map(
          ([nodeId, position]) =>
            [
              nodeId,
              resolveMobileKnowledgeGraphDragPosition({
                start: position,
                translation: { x: 0, y: 0 },
                viewportScale: 1,
                canvas: dimensions,
                node: { width: NODE_WIDTH, height: NODE_HEIGHT },
              }),
            ] as const,
        ),
      ),
    [dimensions, layout],
  );

  const updateDimensions = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setDimensions({
      width: Math.max(MIN_CANVAS_SIZE, width),
      height: Math.max(MIN_CANVAS_SIZE, height),
    });
  }, []);
  const pinNode = useCallback(
    (nodeId: KnowledgeGraphNodeId, gesture: MobileKnowledgeGraphDragGesture) => {
      setPinned((current) => {
        const next = new Map(current);
        next.set(
          nodeId,
          resolveMobileKnowledgeGraphDragPosition({
            ...gesture,
            canvas: dimensions,
            node: { width: NODE_WIDTH, height: NODE_HEIGHT },
          }),
        );
        return next;
      });
    },
    [dimensions.height, dimensions.width],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          panStartX.value = translateX.value;
          panStartY.value = translateY.value;
        })
        .onUpdate((event) => {
          translateX.value = panStartX.value + event.translationX;
          translateY.value = panStartY.value + event.translationY;
        }),
    [panStartX, panStartY, translateX, translateY],
  );
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value;
        })
        .onUpdate((event) => {
          scale.value = Math.max(0.5, Math.min(2.5, pinchStartScale.value * event.scale));
        }),
    [pinchStartScale, scale],
  );
  const canvasGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture],
  );
  const graphStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const setViewport = useCallback(
    (viewport: KnowledgeGraphViewport) => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      if (reduceMotion) {
        scale.value = viewport.scale;
        translateX.value = viewport.translateX;
        translateY.value = viewport.translateY;
        return;
      }
      scale.value = withTiming(viewport.scale, { duration: 140 });
      translateX.value = withTiming(viewport.translateX, { duration: 140 });
      translateY.value = withTiming(viewport.translateY, { duration: 140 });
    },
    [reduceMotion, scale, translateX, translateY],
  );
  useEffect(
    () => () => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    },
    [scale, translateX, translateY],
  );

  return (
    <View className="flex-1 gap-2">
      <ScrollView
        horizontal
        accessibilityLabel={translator.message("knowledgeGraph.filters.label")}
        contentContainerClassName="gap-2 px-3"
        showsHorizontalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: kinds.size === 0 }}
          className={
            kinds.size === 0
              ? "rounded-full bg-primary px-3 py-2"
              : "rounded-full border border-border bg-card px-3 py-2"
          }
          onPress={() => setKinds(new Set())}
        >
          <Text
            className={
              kinds.size === 0
                ? "text-xs font-t3-semibold text-primary-foreground"
                : "text-xs font-t3-semibold text-foreground"
            }
          >
            {translator.message("knowledgeGraph.filter.all")}
          </Text>
        </Pressable>
        {NODE_KINDS.map((kind) => {
          const selected = kinds.has(kind);
          return (
            <Pressable
              key={kind}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              className={
                selected
                  ? "rounded-full bg-primary px-3 py-2"
                  : "rounded-full border border-border bg-card px-3 py-2"
              }
              onPress={() => setKinds((current) => toggleKnowledgeGraphKind(current, kind))}
            >
              <Text
                className={
                  selected
                    ? "text-xs font-t3-semibold text-primary-foreground"
                    : "text-xs font-t3-semibold text-foreground"
                }
              >
                {translator.message(knowledgeGraphNodeKindMessageKey(kind))}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <GestureDetector gesture={canvasGesture}>
        <View
          accessibilityLabel={translator.message("knowledgeGraph.accessibility.canvas")}
          className="flex-1 overflow-hidden rounded-[24px] border border-border bg-screen"
          onLayout={updateDimensions}
        >
          <Animated.View
            style={[{ width: dimensions.width, height: dimensions.height }, graphStyle]}
          >
            <ThemedSvg
              colorClassName="accent-border"
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              width={dimensions.width}
              height={dimensions.height}
            >
              {view.edges.map((edge) => {
                const source = boundedLayout.get(edge.sourceNodeId);
                const target = boundedLayout.get(edge.targetNodeId);
                if (!source || !target) return null;
                return (
                  <Line
                    key={edge.edgeId}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="currentColor"
                    strokeOpacity={Math.max(0.35, edge.confidence)}
                    strokeWidth={1.5}
                  />
                );
              })}
            </ThemedSvg>
            {view.nodes.map((node) => {
              const position = boundedLayout.get(node.nodeId);
              if (!position) return null;
              return (
                <GraphNode
                  key={node.nodeId}
                  label={node.label}
                  accessibilityHint={translator.message("knowledgeGraph.accessibility.nodeHint")}
                  accessibilityLabel={translator.message("knowledgeGraph.accessibility.node", {
                    label: node.label,
                  })}
                  nodeId={node.nodeId}
                  onDragEnd={pinNode}
                  onPress={(nodeId) =>
                    props.onSelectNode(nodeId === props.selectedNodeId ? null : nodeId)
                  }
                  position={position}
                  reduceMotion={reduceMotion}
                  selected={node.nodeId === props.selectedNodeId}
                  viewportScale={scale}
                />
              );
            })}
          </Animated.View>

          <View
            accessibilityLabel={translator.message("knowledgeGraph.accessibility.zoomControls")}
            className="absolute bottom-3 right-3 gap-2"
          >
            <ZoomButton
              icon="plus"
              label={translator.message("knowledgeGraph.zoomIn")}
              onPress={() =>
                setViewport({
                  scale: Math.min(2.5, scale.value + 0.25),
                  translateX: translateX.value,
                  translateY: translateY.value,
                })
              }
            />
            <ZoomButton
              icon="minus"
              label={translator.message("knowledgeGraph.zoomOut")}
              onPress={() =>
                setViewport({
                  scale: Math.max(0.5, scale.value - 0.25),
                  translateX: translateX.value,
                  translateY: translateY.value,
                })
              }
            />
            <ZoomButton
              icon="arrow.counterclockwise"
              label={translator.message("knowledgeGraph.resetView")}
              onPress={() => setViewport({ scale: 1, translateX: 0, translateY: 0 })}
            />
          </View>

          <View className="absolute left-3 top-3 rounded-full bg-card px-3 py-1.5">
            <Text className="text-xs text-foreground-muted">
              {translator.message("knowledgeGraph.resultCount", {
                count: view.matchingNodeCount,
              })}
            </Text>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  node: {
    position: "absolute",
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
});
