// @effect-diagnostics cryptoRandomUUID:off - The browser-compatible WebSocket factory accepts synchronous session identifiers.
// @effect-diagnostics globalTimers:off - WebSocket handshakes and termination acknowledgements are callback boundaries outside an Effect service.
import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";
import { buildAssemblyAiStreamingUrl } from "@t3tools/shared/assemblyAiStreamingUrl";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
const MAX_RECORDING_SECONDS = 5 * 60;
const MAX_SESSIONS = 4;
const CONNECT_TIMEOUT_MS = 10_000;
const TERMINATION_TIMEOUT_MS = 2_000;

interface AssemblyAiProxySocket {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(): void;
}

interface ProxySession {
  readonly socket: AssemblyAiProxySocket;
  readonly finalized: Map<number, string>;
  partial: string;
  transcript: string;
  failure: Error | null;
  resolveTermination: (() => void) | null;
  readonly retainAudio: boolean;
  readonly maxAudioBytes: number;
  audioBytes: number;
  audio: Uint8Array[];
  finishing: boolean;
}

function updateTranscript(session: ProxySession, value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (message.type === "Termination") {
    session.resolveTermination?.();
    return;
  }
  if (message.type === "Error" || message.type === "error") {
    session.failure = new Error(
      typeof message.error === "string"
        ? message.error
        : typeof message.message === "string"
          ? message.message
          : "AssemblyAI reported a streaming service error.",
    );
    return;
  }
  if (message.type !== "Turn" || typeof message.transcript !== "string") return;
  const text = message.transcript.trim().replace(/\s+/gu, " ");
  const order = typeof message.turn_order === "number" ? message.turn_order : null;
  if (message.end_of_turn === true && text.length > 0 && order !== null) {
    session.finalized.set(order, text);
    session.partial = "";
  } else if (message.end_of_turn !== true) {
    session.partial = text;
  }
  session.transcript = [...session.finalized.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, part]) => part)
    .concat(session.partial)
    .filter(Boolean)
    .join(" ");
}

function closeSession(session: ProxySession): void {
  session.audio = [];
  session.resolveTermination?.();
  session.resolveTermination = null;
  session.socket.onopen = null;
  session.socket.onmessage = null;
  session.socket.onerror = null;
  session.socket.onclose = null;
  if (
    session.socket.readyState === SOCKET_CONNECTING ||
    session.socket.readyState === SOCKET_OPEN
  ) {
    session.socket.close();
  }
}

export function createAssemblyAiStreamingProxy(options: {
  readonly createSocket?: (url: string) => AssemblyAiProxySocket;
  readonly createSessionId?: () => string;
}) {
  const sessions = new Map<string, ProxySession>();
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as AssemblyAiProxySocket);
  const createSessionId = options.createSessionId ?? (() => globalThis.crypto.randomUUID());

  const start = async (config: AssemblyAiStreamingTokenResult, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error("Voice input was cancelled.");
    if (sessions.size >= MAX_SESSIONS) throw new Error("Too many active voice sessions.");
    const sessionId = createSessionId();
    const socket = createSocket(buildAssemblyAiStreamingUrl(config));
    socket.binaryType = "arraybuffer";
    const session: ProxySession = {
      socket,
      finalized: new Map(),
      partial: "",
      transcript: "",
      failure: null,
      resolveTermination: null,
      retainAudio: config.options?.advancedMode === true,
      maxAudioBytes: config.sampleRate * 2 * MAX_RECORDING_SECONDS,
      audioBytes: 0,
      audio: [],
      finishing: false,
    };
    sessions.set(sessionId, session);
    socket.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      try {
        updateTranscript(session, JSON.parse(data));
      } catch {
        session.failure = new Error("AssemblyAI returned an unreadable streaming message.");
      }
    };
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        globalThis.clearTimeout(timeout);
        sessions.delete(sessionId);
        closeSession(session);
        reject(new Error("Voice input was cancelled."));
      };
      const timeout = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        reject(new Error("AssemblyAI connection timed out."));
      }, CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        signal?.removeEventListener("abort", abort);
        globalThis.clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        signal?.removeEventListener("abort", abort);
        globalThis.clearTimeout(timeout);
        reject(new Error("AssemblyAI streaming connection failed."));
      };
      signal?.addEventListener("abort", abort, { once: true });
    }).catch((error) => {
      sessions.delete(sessionId);
      closeSession(session);
      throw error;
    });
    return { sessionId };
  };

  const getSession = (sessionId: string): ProxySession => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Voice streaming session is not active.");
    if (session.failure) {
      sessions.delete(sessionId);
      closeSession(session);
      throw session.failure;
    }
    return session;
  };

  const push = async (input: { readonly sessionId: string; readonly audio: Uint8Array }) => {
    if (input.audio.byteLength > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error(`Audio chunk exceeds ${MAX_AUDIO_CHUNK_BYTES} bytes.`);
    }
    const session = getSession(input.sessionId);
    if (session.finishing) throw new Error("Voice streaming session is finishing.");
    if (input.audio.byteLength % 2 !== 0)
      throw new Error("Audio must contain complete PCM16 samples.");
    if (session.audioBytes + input.audio.byteLength > session.maxAudioBytes) {
      sessions.delete(input.sessionId);
      closeSession(session);
      throw new Error("Voice recordings are limited to five minutes.");
    }
    if (session.socket.readyState !== SOCKET_OPEN)
      throw new Error("Voice streaming session closed.");
    session.socket.send(input.audio);
    session.audioBytes += input.audio.byteLength;
    if (session.retainAudio) session.audio.push(input.audio.slice());
    return { transcript: session.transcript };
  };

  const finish = async (sessionId: string) => {
    const session = getSession(sessionId);
    if (session.finishing) throw new Error("Voice streaming session is already finishing.");
    session.finishing = true;
    const termination = new Promise<void>((resolve) => {
      const timeout = globalThis.setTimeout(resolve, TERMINATION_TIMEOUT_MS);
      session.resolveTermination = () => {
        globalThis.clearTimeout(timeout);
        resolve();
      };
    });
    try {
      session.socket.send(JSON.stringify({ type: "Terminate" }));
      await termination;
      if (session.failure) throw session.failure;
      if (!session.retainAudio) return { transcript: session.transcript };
      const audio = new Uint8Array(session.audioBytes);
      let offset = 0;
      for (const chunk of session.audio) {
        audio.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { transcript: session.transcript, audio };
    } finally {
      sessions.delete(sessionId);
      closeSession(session);
    }
  };

  const cancel = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    closeSession(session);
  };

  const dispose = () => {
    for (const session of sessions.values()) closeSession(session);
    sessions.clear();
  };

  return { start, push, finish, cancel, dispose } as const;
}
