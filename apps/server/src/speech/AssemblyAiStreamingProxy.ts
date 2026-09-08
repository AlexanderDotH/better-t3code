// @effect-diagnostics globalTimers:off - WebSocket handshakes and termination acknowledgements are callback boundaries outside an Effect service.
import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeTimers from "node:timers";

/* oxlint-disable unicorn/prefer-add-event-listener -- The injected React-style socket contract uses assignable handlers so cleanup can detach every callback deterministically. */

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
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
}

function streamingUrl(config: AssemblyAiStreamingTokenResult): string {
  const url = new URL(config.websocketUrl);
  url.searchParams.set("sample_rate", String(config.sampleRate));
  url.searchParams.set("encoding", config.encoding);
  url.searchParams.set("speech_model", config.speechModel);
  url.searchParams.set("format_turns", "true");
  url.searchParams.set("prompt", config.context.prompt);
  if (config.context.keyterms.length > 0) {
    url.searchParams.set("keyterms_prompt", JSON.stringify(config.context.keyterms));
  }
  url.searchParams.set("token", config.token);
  return url.toString();
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
  const createSessionId = options.createSessionId ?? NodeCrypto.randomUUID;

  const start = async (config: AssemblyAiStreamingTokenResult) => {
    const sessionId = createSessionId();
    const socket = createSocket(streamingUrl(config));
    socket.binaryType = "arraybuffer";
    const session: ProxySession = {
      socket,
      finalized: new Map(),
      partial: "",
      transcript: "",
      failure: null,
      resolveTermination: null,
    };
    socket.onmessage = ({ data }) => {
      if (typeof data !== "string") return;
      try {
        updateTranscript(session, JSON.parse(data));
      } catch {
        session.failure = new Error("AssemblyAI returned an unreadable streaming message.");
      }
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = NodeTimers.setTimeout(
        () => reject(new Error("AssemblyAI connection timed out.")),
        CONNECT_TIMEOUT_MS,
      );
      socket.onopen = () => {
        NodeTimers.clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        NodeTimers.clearTimeout(timeout);
        reject(new Error("AssemblyAI streaming connection failed."));
      };
    }).catch((error) => {
      closeSession(session);
      throw error;
    });
    sessions.set(sessionId, session);
    return { sessionId };
  };

  const getSession = (sessionId: string): ProxySession => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Voice streaming session is not active.");
    if (session.failure) throw session.failure;
    return session;
  };

  const push = async (input: { readonly sessionId: string; readonly audio: Uint8Array }) => {
    if (input.audio.byteLength > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error(`Audio chunk exceeds ${MAX_AUDIO_CHUNK_BYTES} bytes.`);
    }
    const session = getSession(input.sessionId);
    if (session.socket.readyState !== SOCKET_OPEN)
      throw new Error("Voice streaming session closed.");
    session.socket.send(input.audio);
    return { transcript: session.transcript };
  };

  const finish = async (sessionId: string) => {
    const session = getSession(sessionId);
    const termination = new Promise<void>((resolve) => {
      const timeout = NodeTimers.setTimeout(resolve, TERMINATION_TIMEOUT_MS);
      session.resolveTermination = () => {
        NodeTimers.clearTimeout(timeout);
        resolve();
      };
    });
    session.socket.send(JSON.stringify({ type: "Terminate" }));
    await termination;
    sessions.delete(sessionId);
    closeSession(session);
    if (session.failure) throw session.failure;
    return { transcript: session.transcript };
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
