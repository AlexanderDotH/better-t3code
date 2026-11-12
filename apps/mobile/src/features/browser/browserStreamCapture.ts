import type { PreviewStreamMessage } from "./preview-stream-document";
import type { PreviewAnnotationRect } from "@t3tools/contracts";
import { browserStreamPoint, browserStreamRect } from "./browserStreamCoordinates";

const MAX_RECORDING_BYTES = 16 * 1024 * 1024;
const MAX_RECORDING_MS = 60_000;

export function createBrowserStreamCapture(
  canvas: HTMLCanvasElement,
  post: (message: PreviewStreamMessage) => void,
  getViewport: () => { readonly width: number; readonly height: number } | null,
) {
  let annotation = false;
  let elementPicking = false;
  let pickSequence = 0;
  let selection: {
    id: number;
    image: HTMLCanvasElement;
    point: { x: number; y: number };
    viewport: { width: number; height: number };
    resolved: boolean;
  } | null = null;
  const highlight = document.createElement("canvas");
  highlight.setAttribute("aria-hidden", "true");
  highlight.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;display:none";
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let pickedPointer: number | null = null;
  const setAnnotation = (enabled: boolean) => {
    annotation = enabled;
    post({ type: "annotation", active: enabled });
  };
  const setElementPicking = (enabled: boolean) => {
    elementPicking = enabled;
    selection = null;
    highlight.style.display = "none";
    post({ type: "elementPicking", active: enabled });
  };
  const capture = (point?: { x: number; y: number }) => {
    if (!canvas.width || !canvas.height) return;
    try {
      const image = document.createElement("canvas");
      image.width = canvas.width;
      image.height = canvas.height;
      const context = image.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(canvas, 0, 0);
      if (point) {
        context.strokeStyle = "#ef4444";
        context.lineWidth = Math.max(3, image.width / 300);
        context.beginPath();
        context.arc(point.x, point.y, Math.max(18, image.width / 35), 0, 2 * Math.PI);
        context.stroke();
      }
      post({ type: "capture", dataUrl: image.toDataURL("image/png"), annotation: !!point });
    } catch {
      post({ type: "captureError" });
    }
  };
  const pick = (event: PointerEvent) => {
    if (!annotation && !elementPicking) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pickedPointer = event.pointerId;
    if (elementPicking) {
      const box = canvas.getBoundingClientRect();
      const viewport = getViewport();
      const point = browserStreamPoint(
        { x: event.clientX, y: event.clientY },
        box,
        canvas,
        viewport,
      );
      if (!point || !viewport) return;
      const image = document.createElement("canvas");
      image.width = canvas.width;
      image.height = canvas.height;
      const context = image.getContext("2d");
      if (!context) {
        post({ type: "captureError" });
        return;
      }
      context.drawImage(canvas, 0, 0);
      selection = { id: ++pickSequence, image, point, viewport, resolved: false };
      highlight.width = image.width;
      highlight.height = image.height;
      highlight.getContext("2d")?.drawImage(image, 0, 0);
      canvas.after(highlight);
      highlight.style.display = "block";
      post({ type: "elementPick", id: selection.id, point });
      return;
    }
    const box = canvas.getBoundingClientRect();
    const fit = Math.min(box.width / canvas.width, box.height / canvas.height);
    const x = (event.clientX - box.left - (box.width - canvas.width * fit) / 2) / fit;
    const y = (event.clientY - box.top - (box.height - canvas.height * fit) / 2) / fit;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;
    setAnnotation(false);
    capture({ x, y });
  };
  const suppressPickedPointer = (event: PointerEvent) => {
    if (!elementPicking && event.pointerId !== pickedPointer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "pointerup" || event.type === "pointercancel") pickedPointer = null;
  };
  canvas.addEventListener("pointerdown", pick, true);
  canvas.addEventListener("pointermove", suppressPickedPointer, true);
  canvas.addEventListener("pointerup", suppressPickedPointer, true);
  canvas.addEventListener("pointercancel", suppressPickedPointer, true);
  const stopRecording = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (recorder?.state === "recording") recorder.stop();
  };
  return {
    capture,
    annotate: () => {
      if (elementPicking) setElementPicking(false);
      setAnnotation(!annotation);
    },
    pickElement: () => {
      if (annotation) setAnnotation(false);
      setElementPicking(!elementPicking);
    },
    cancelElementPicking: () => {
      if (elementPicking) setElementPicking(false);
    },
    resolveElementPick: (id: number, rect: PreviewAnnotationRect | null) => {
      if (!elementPicking || selection?.id !== id) return;
      const context = highlight.getContext("2d");
      if (!context) return;
      context.drawImage(selection.image, 0, 0);
      context.strokeStyle = "#ef4444";
      context.lineWidth = Math.max(3, highlight.width / 300);
      if (rect) {
        const box = browserStreamRect(rect, highlight, selection.viewport);
        context.fillStyle = "rgba(239,68,68,0.12)";
        context.fillRect(box.x, box.y, box.width, box.height);
        context.strokeRect(box.x, box.y, box.width, box.height);
      } else {
        const point = browserStreamRect(
          { ...selection.point, width: 0, height: 0 },
          highlight,
          selection.viewport,
        );
        context.beginPath();
        context.arc(point.x, point.y, Math.max(18, highlight.width / 35), 0, 2 * Math.PI);
        context.stroke();
      }
      selection.resolved = true;
    },
    confirmElementPick: () => {
      if (!elementPicking || !selection?.resolved) return;
      try {
        selection.resolved = false;
        post({
          type: "elementCapture",
          id: selection.id,
          dataUrl: highlight.toDataURL("image/png"),
        });
      } catch {
        selection.resolved = true;
        post({ type: "captureError" });
      }
    },
    toggleRecording: () => {
      if (recorder) {
        stopRecording();
        return;
      }
      if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
        post({ type: "captureError", unavailable: true });
        return;
      }
      let recordingStream: MediaStream | null = null;
      try {
        const stream = canvas.captureStream(15);
        recordingStream = stream;
        const next = new MediaRecorder(stream);
        recorder = next;
        const chunks: Blob[] = [];
        let bytes = 0;
        next.ondataavailable = (event) => {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes >= MAX_RECORDING_BYTES) stopRecording();
        };
        next.onerror = () => {
          post({ type: "captureError" });
          stopRecording();
        };
        next.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          recorder = null;
          post({ type: "recording", active: false });
          if (disposed || bytes === 0) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (!disposed && typeof reader.result === "string")
              post({ type: "capture", dataUrl: reader.result, annotation: false });
          };
          reader.onerror = () => post({ type: "captureError" });
          reader.readAsDataURL(new Blob(chunks, { type: next.mimeType }));
        };
        next.start(1_000);
        timer = setTimeout(stopRecording, MAX_RECORDING_MS);
        post({ type: "recording", active: true });
      } catch {
        recordingStream?.getTracks().forEach((track) => track.stop());
        recorder = null;
        post({ type: "captureError", unavailable: true });
      }
    },
    dispose: () => {
      disposed = true;
      annotation = false;
      elementPicking = false;
      selection = null;
      highlight.remove();
      stopRecording();
      canvas.removeEventListener("pointerdown", pick, true);
      canvas.removeEventListener("pointermove", suppressPickedPointer, true);
      canvas.removeEventListener("pointerup", suppressPickedPointer, true);
      canvas.removeEventListener("pointercancel", suppressPickedPointer, true);
    },
  };
}
