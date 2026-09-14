import {
  VisualizationPreviewCache,
  type VisualizationRenderRequest,
} from "@t3tools/client-runtime/visualizations/model";

type PreviewJob = {
  request: VisualizationRenderRequest;
  cacheKey: string;
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
};

/** Runs only the next preview, and rejects cancelled requests before accepting replies. */
export function createPreviewQueue(
  onRequest: (request: VisualizationRenderRequest | null) => void,
) {
  const cache = new VisualizationPreviewCache();
  let waiting: PreviewJob[] = [];
  let active: PreviewJob | null = null;
  const pump = () => {
    if (active) return;
    active = waiting.shift() ?? null;
    onRequest(active?.request ?? null);
  };
  return {
    request(request: VisualizationRenderRequest, signal: AbortSignal): Promise<string> {
      if (signal.aborted) return Promise.reject(new Error("Cancelled"));
      const cacheKey = JSON.stringify([request.format, request.source, request.theme]);
      const cached = cache.get(cacheKey);
      if (cached) return Promise.resolve(cached);
      return new Promise((resolve, reject) => {
        const abort = () => {
          waiting = waiting.filter((entry) => entry !== job);
          if (active === job) {
            active = null;
            pump();
          }
          reject(new Error("Cancelled"));
        };
        const job: PreviewJob = {
          request,
          cacheKey,
          resolve: (svg) => {
            signal.removeEventListener("abort", abort);
            resolve(svg);
          },
          reject: (error) => {
            signal.removeEventListener("abort", abort);
            reject(error);
          },
        };
        signal.addEventListener("abort", abort, { once: true });
        waiting.push(job);
        pump();
      });
    },
    result(requestId: string, result: string | Error) {
      if (active?.request.requestId !== requestId) return;
      if (result instanceof Error) active.reject(result);
      else {
        cache.set(active.cacheKey, result);
        active.resolve(result);
      }
      active = null;
      pump();
    },
    dispose() {
      active?.reject(new Error("Cancelled"));
      for (const job of waiting) job.reject(new Error("Cancelled"));
      active = null;
      waiting = [];
      cache.clear();
    },
  };
}
