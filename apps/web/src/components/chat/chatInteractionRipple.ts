const MAX_ARRIVAL_PIXELS = 512_000;
const MAX_ARRIVAL_DIMENSION = 2048;

const VERTEX_SHADER = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 resolution;
uniform vec2 size;
uniform vec2 origin;
uniform vec3 tint;
uniform float progress;
uniform float strength;
uniform float arrival;
void main() {
  float extent = max(size.x, size.y);
  vec2 relativeSize = size / extent;
  vec2 point = gl_FragCoord.xy / resolution * relativeSize;
  if (arrival > 0.5) {
    float sweep = point.x + point.y * 0.18;
    float center = mix(-0.2, relativeSize.x + relativeSize.y * 0.18 + 0.2, progress);
    float band = exp(-pow((sweep - center) / 0.14, 2.0));
    float alpha = band * 0.1 * sin(progress * 3.14159265) * strength;
    gl_FragColor = vec4(tint * alpha, alpha);
    return;
  }
  float distance = length(point - origin / extent);
  float radius = progress * length(relativeSize);
  float width = max(5.0, min(size.y * 0.24, 12.0)) / extent;
  float ring = exp(-pow((distance - radius) / width, 2.0));
  float glow = exp(-distance / (20.0 / extent + radius * 0.55));
  float alpha = (ring * 0.16 + glow * 0.05) * pow(1.0 - progress, 1.7) * strength;
  gl_FragColor = vec4(tint * alpha, alpha);
}
`;

/** One small, reusable GPU surface per transcript; the caller owns its finite frame loop. */
export function createChatInteractionRipple(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const dispose = () => {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  if (!vertex || !fragment || !program || !buffer) {
    dispose();
    return null;
  }
  gl.shaderSource(vertex, VERTEX_SHADER);
  gl.shaderSource(fragment, FRAGMENT_SHADER);
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose();
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, "resolution");
  const size = gl.getUniformLocation(program, "size");
  const origin = gl.getUniformLocation(program, "origin");
  const tint = gl.getUniformLocation(program, "tint");
  const progress = gl.getUniformLocation(program, "progress");
  const strength = gl.getUniformLocation(program, "strength");
  const arrival = gl.getUniformLocation(program, "arrival");
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
  return {
    prepare(
      width: number,
      height: number,
      x: number,
      y: number,
      color: string,
      intensity: number,
      messageArrival = false,
    ) {
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        messageArrival ? Math.sqrt(MAX_ARRIVAL_PIXELS / Math.max(1, width * height)) : Infinity,
        messageArrival ? MAX_ARRIVAL_DIMENSION / Math.max(1, width, height) : Infinity,
      );
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      const scale = messageArrival
        ? Math.min(1, MAX_ARRIVAL_DIMENSION / Math.max(1, width, height))
        : 1;
      gl.uniform2f(size, width * scale, height * scale);
      gl.uniform2f(origin, x * scale, (height - y) * scale);
      if (colorContext) {
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = color;
        colorContext.fillRect(0, 0, 1, 1);
        const pixel = colorContext.getImageData(0, 0, 1, 1).data;
        gl.uniform3f(tint, pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255);
      } else {
        gl.uniform3f(tint, 0.65, 0.65, 0.65);
      }
      gl.uniform1f(strength, intensity);
      gl.uniform1f(arrival, messageArrival ? 1 : 0);
    },
    paint(value: number) {
      gl.uniform1f(progress, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose,
  };
}
