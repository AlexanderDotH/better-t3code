import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import {
  isVisualizationResponse,
  VISUALIZATION_CHANNEL,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";

import { uuidv4 } from "../../lib/uuid";
import { createPreviewQueue } from "./previewQueue";

const RENDER_TIMEOUT_MS = 30_000;
const rendererAssets = {
  mermaid: () => require("../../../assets/visualizations/mermaid.html"),
  plantuml: () => require("../../../assets/visualizations/plantuml.html"),
  dot: () => require("../../../assets/visualizations/dot.html"),
  vega: () => require("../../../assets/visualizations/vega.html"),
};

export interface VisualizationRuntimeHandle {
  exportPng(): void;
  exportSvg(): void;
  view(action: "zoom-in" | "zoom-out" | "fit" | "pan" | "select"): void;
}

export const VisualizationRuntime = forwardRef<
  VisualizationRuntimeHandle,
  {
    request: VisualizationRenderRequest;
    onResult: (svg: string) => void;
    onError: (error: string) => void;
    onPng?: (dataUrl: string) => void;
    onSvg?: (svg: string) => void;
  }
>(function VisualizationRuntime({ request, onResult, onError, onPng, onSvg }, ref) {
  const webView = useRef<WebView>(null);
  const [html, setHtml] = useState<{ family: string; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const family = request.format === "vega-lite" ? "vega" : request.format;
  const callbacks = useRef({ onResult, onError, onPng, onSvg });
  const pending = useRef(request.requestId);
  const pendingExports = useRef(new Map<string, "svg" | "png">());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webSource = useMemo(() => ({ html: html?.text ?? "" }), [html]);
  useLayoutEffect(() => {
    callbacks.current = { onResult, onError, onPng, onSvg };
    if (pending.current !== request.requestId) pendingExports.current.clear();
    pending.current = request.requestId;
  }, [onResult, onError, onPng, onSvg, request.requestId]);
  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const asset = await Asset.fromModule(rendererAssets[family]()).downloadAsync();
      if (!asset.localUri) throw new Error("The bundled diagram renderer could not be loaded.");
      const text = await new File(asset.localUri).text();
      if (!cancelled) {
        setReady(false);
        setHtml({ family, text });
      }
    })().catch((error: unknown) => {
      if (!cancelled)
        callbacks.current.onError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  useEffect(() => {
    pendingExports.current.clear();
    if (ready && html?.family === family) webView.current?.postMessage(JSON.stringify(request));
    timer.current = setTimeout(() => {
      callbacks.current.onError("The diagram took too long to render. Simplify it and try again.");
    }, RENDER_TIMEOUT_MS);
    return finish;
  }, [request, ready, html, family, finish]);

  useImperativeHandle(ref, () => {
    const exportImage = (format: "svg" | "png") => {
      if (pendingExports.current.size) return;
      const requestId = uuidv4();
      pendingExports.current.set(requestId, format);
      timer.current = setTimeout(() => {
        pendingExports.current.clear();
        callbacks.current.onError("The diagram export took too long. Try again.");
      }, RENDER_TIMEOUT_MS);
      webView.current?.postMessage(
        JSON.stringify({ channel: VISUALIZATION_CHANNEL, type: `export-${format}`, requestId }),
      );
    };
    return {
      exportPng: () => exportImage("png"),
      exportSvg: () => exportImage("svg"),
      view(action) {
        webView.current?.postMessage(
          JSON.stringify({
            channel: VISUALIZATION_CHANNEL,
            type: "view",
            requestId: pending.current,
            action,
          }),
        );
      },
    };
  }, []);

  if (!html || html.family !== family) return null;
  return (
    <WebView
      key={family}
      ref={webView}
      source={webSource}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      bounces={false}
      scrollEnabled={false}
      onMessage={({ nativeEvent }) => {
        let response: unknown;
        try {
          response = JSON.parse(nativeEvent.data);
        } catch {
          return;
        }
        if (!isVisualizationResponse(response)) return;
        if (response.type === "ready") {
          setReady(true);
          return;
        }
        if (pendingExports.current.has(response.requestId)) {
          finish();
          const kind = pendingExports.current.get(response.requestId);
          pendingExports.current.delete(response.requestId);
          if (response.type === "error") callbacks.current.onError(response.error);
          if (kind === "svg" && response.type === "result") callbacks.current.onSvg?.(response.svg);
          if (kind === "png" && response.type === "png")
            callbacks.current.onPng?.(response.dataUrl);
          return;
        }
        if (response.requestId !== pending.current) return;
        finish();
        if (response.type === "result") callbacks.current.onResult(response.svg);
        if (response.type === "error") callbacks.current.onError(response.error);
        if (response.type === "png") callbacks.current.onPng?.(response.dataUrl);
      }}
      onError={({ nativeEvent }) => {
        finish();
        callbacks.current.onError(nativeEvent.description);
      }}
      onContentProcessDidTerminate={() => {
        finish();
        callbacks.current.onError("The diagram renderer stopped. Reopen the preview to retry.");
      }}
      onRenderProcessGone={() => {
        finish();
        callbacks.current.onError("The diagram renderer stopped. Reopen the preview to retry.");
      }}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
});

type RequestPreview = (request: VisualizationRenderRequest, signal: AbortSignal) => Promise<string>;
const PreviewContext = createContext<RequestPreview | null>(null);

/** One mounted provider owns the serialized preview WebView for the mobile client. */
export function VisualizationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<VisualizationRenderRequest | null>(null);
  const [queue] = useState(() => createPreviewQueue(setRequest));
  useEffect(() => () => queue.dispose(), [queue]);
  return (
    <PreviewContext.Provider value={queue.request}>
      {children}
      {request ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            left: -10000,
            width: 1000,
            height: 720,
            opacity: 0,
            overflow: "hidden",
          }}
        >
          <VisualizationRuntime
            request={request}
            onResult={(svg) => queue.result(request.requestId, svg)}
            onError={(error) => queue.result(request.requestId, new Error(error))}
          />
        </View>
      ) : null}
    </PreviewContext.Provider>
  );
}

export function useVisualizationPreview() {
  const context = useContext(PreviewContext);
  if (!context) throw new Error("VisualizationBlock requires VisualizationProvider.");
  return context;
}
