import {
  CipherEnvelope,
  decryptJson,
  encryptJson,
  isCipherEnvelope,
} from "@streambin/crypto";
import { objectUpdateStreamPath, normalizePath, StreamEventEnvelope } from "@streambin/shared";

export type DecodedPayload =
  | { type: "message"; value: string }
  | { type: "json"; value: unknown };

type EncodedPayload =
  | { t: "m"; d: string }
  | { t: "j"; d: unknown }
  | { op: "set"; value: CipherEnvelope };

function isTaggedPayload(value: unknown): value is { t: "m" | "j"; d: unknown } {
  return value !== null && typeof value === "object" && "t" in value && "d" in value;
}

function isOpPayload(value: unknown): value is { op: "set"; value: CipherEnvelope } {
  return (
    value !== null &&
    typeof value === "object" &&
    "op" in value &&
    (value as { op: string }).op === "set" &&
    "value" in value &&
    isCipherEnvelope((value as { value: unknown }).value)
  );
}

export type StreamMessage = StreamEventEnvelope & {
  decoded: DecodedPayload;
};
export type StreamValue = DecodedPayload["value"];
export type ObjectPatch = Record<string, unknown>;

export type ListenMode = "message" | "json" | "both";

export type StreambinClientOptions = {
  baseUrl: string;
  namespace: string;
  passphrase: string;
  fetchImpl?: typeof fetch;
};

export type ListenOptions = {
  after?: number;
  mode?: ListenMode;
  heartbeatTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  onStatus?: (connected: boolean) => void;
};

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

function parseCipherEnvelope(value: unknown): CipherEnvelope | null {
  if (isCipherEnvelope(value)) {
    return value;
  }
  return null;
}

function shouldEmit(mode: ListenMode, payload: DecodedPayload): boolean {
  if (mode === "both") {
    return true;
  }
  return payload.type === mode;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepClone(v);
    }
    return out as T;
  }
  return value;
}

function setByPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let node: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    const existing = node[seg];
    if (!isPlainObject(existing)) {
      node[seg] = {};
    }
    node = node[seg] as Record<string, unknown>;
  }

  node[segments[segments.length - 1]] = value;
}

function applyObjectPatch(current: unknown, patch: ObjectPatch): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(current) ? deepClone(current) : {};

  for (const [key, value] of Object.entries(patch)) {
    if (key.includes(".")) {
      setByPath(base, key, value);
      continue;
    }
    base[key] = value;
  }

  return base;
}

async function encodeMessage(passphrase: string, value: string): Promise<string> {
  const envelope = await encryptJson(passphrase, { t: "m", d: value } satisfies EncodedPayload);
  return JSON.stringify(envelope);
}

async function encodeJson(passphrase: string, value: unknown): Promise<string> {
  const envelope = await encryptJson(passphrase, { t: "j", d: value } satisfies EncodedPayload);
  return JSON.stringify(envelope);
}

async function decodeEventPayload(passphrase: string, payload: string): Promise<DecodedPayload | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const envelope = parseCipherEnvelope(parsed);
  if (!envelope) {
    return null;
  }

  try {
    const decoded = await decryptJson<unknown>(passphrase, envelope);

    if (isTaggedPayload(decoded)) {
      const tagged = decoded;
      if (tagged.t === "m") {
        return { type: "message", value: tagged.d as string };
      }
      if (tagged.t === "j") {
        return { type: "json", value: tagged.d };
      }
    }

    if (isOpPayload(decoded)) {
      const doc = await decryptJson(passphrase, decoded.value);
      return { type: "json", value: doc };
    }

    return { type: "json", value: decoded };
  } catch {
    return null;
  }
}

class ResilientSse {
  private readonly urlFactory: (cursor: number) => string;
  private readonly heartbeatTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly onMessage: (event: StreamEventEnvelope) => Promise<void>;
  private readonly onStatus?: (connected: boolean) => void;

  private cursor: number;
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;
  private destroyed = false;
  private paused = false;

  constructor(args: {
    urlFactory: (cursor: number) => string;
    initialCursor: number;
    heartbeatTimeoutMs: number;
    reconnectBaseMs: number;
    reconnectMaxMs: number;
    onMessage: (event: StreamEventEnvelope) => Promise<void>;
    onStatus?: (connected: boolean) => void;
  }) {
    this.urlFactory = args.urlFactory;
    this.cursor = args.initialCursor;
    this.heartbeatTimeoutMs = args.heartbeatTimeoutMs;
    this.reconnectBaseMs = args.reconnectBaseMs;
    this.reconnectMaxMs = args.reconnectMaxMs;
    this.onMessage = args.onMessage;
    this.onStatus = args.onStatus;
  }

  start(): void {
    if (typeof EventSource === "undefined") {
      throw new Error("EventSource is not available in this runtime");
    }

    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.handleOffline);
      window.addEventListener("online", this.handleOnline);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    this.connect();
  }

  stop(): void {
    this.destroyed = true;
    this.setConnected(false);
    this.clearTimers();
    this.closeSource();

    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.handleOffline);
      window.removeEventListener("online", this.handleOnline);
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  private readonly handleOffline = () => {
    this.paused = true;
    this.setConnected(false);
    this.clearReconnect();
    this.closeSource();
  };

  private readonly handleOnline = () => {
    this.paused = false;
    this.connect();
  };

  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.paused = true;
      this.setConnected(false);
      this.clearReconnect();
      this.closeSource();
      return;
    }

    this.paused = false;
    this.connect();
  };

  private setConnected(connected: boolean) {
    this.onStatus?.(connected);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers() {
    this.clearReconnect();
    this.clearHeartbeat();
  }

  private scheduleReconnect(delay: number) {
    if (this.destroyed || this.paused) {
      return;
    }

    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private resetHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.setConnected(false);
      this.closeSource();
      this.scheduleReconnect(this.nextBackoff());
    }, this.heartbeatTimeoutMs);
  }

  private nextBackoff() {
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.backoff, this.reconnectMaxMs);
    this.backoff += 1;
    return delay;
  }

  private closeSource() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private connect() {
    if (this.destroyed || this.paused || this.source) {
      return;
    }

    const source = new EventSource(this.urlFactory(this.cursor));
    this.source = source;

    source.onopen = () => {
      this.backoff = 0;
      this.setConnected(true);
      this.resetHeartbeat();
    };

    source.onmessage = (event) => {
      this.resetHeartbeat();
      this.backoff = 0;

      const message = JSON.parse(event.data) as StreamEventEnvelope;
      this.cursor = Math.max(this.cursor, message.timestamp);
      void this.onMessage(message);
    };

    source.addEventListener("ping", () => {
      this.resetHeartbeat();
    });

    source.addEventListener("reconnect", (event) => {
      this.resetHeartbeat();
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { cursor?: number };
        if (typeof data.cursor === "number") {
          this.cursor = Math.max(this.cursor, data.cursor);
        }
      } catch {
        // ignore payload parsing failure
      }

      this.closeSource();
      this.scheduleReconnect(0);
    });

    source.onerror = () => {
      this.setConnected(false);
      this.closeSource();
      this.scheduleReconnect(this.nextBackoff());
    };
  }
}

export class StreambinClient {
  private readonly baseUrl: string;
  private readonly namespace: string;
  private readonly passphrase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StreambinClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.namespace = options.namespace;
    this.passphrase = options.passphrase;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  private streamUrl(path: string, search?: URLSearchParams): string {
    const suffix = search ? `?${search.toString()}` : "";
    return `${this.baseUrl}/api/streams/${encodeURIComponent(this.namespace)}/${path}${suffix}`;
  }

  private docUrl(path: string): string {
    return `${this.baseUrl}/api/docs/${encodeURIComponent(this.namespace)}/${path}`;
  }

  private normalize(path: string): string {
    return normalizePath(path)
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  async appendMessage(path: string, message: string): Promise<StreamEventEnvelope> {
    const ciphertext = await encodeMessage(this.passphrase, message);
    const response = await this.fetchImpl(this.streamUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: ciphertext,
    });

    if (!response.ok) {
      throw new Error(`Failed to append stream message (${response.status})`);
    }

    return response.json();
  }

  async appendJson(path: string, value: unknown): Promise<StreamEventEnvelope> {
    const ciphertext = await encodeJson(this.passphrase, value);
    const response = await this.fetchImpl(this.streamUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: ciphertext,
    });

    if (!response.ok) {
      throw new Error(`Failed to append stream json (${response.status})`);
    }

    return response.json();
  }

  async getStream(path: string, options?: { after?: number; limit?: number; mode?: ListenMode }): Promise<StreamMessage[]> {
    const search = new URLSearchParams();
    if (options?.after) {
      search.set("after", String(options.after));
    }
    if (options?.limit) {
      search.set("limit", String(options.limit));
    }

    const response = await this.fetchImpl(this.streamUrl(this.normalize(path), search));
    if (!response.ok) {
      throw new Error(`Failed to fetch stream (${response.status})`);
    }

    const data = (await response.json()) as { events: StreamEventEnvelope[] };
    const mode = options?.mode ?? "both";
    const decoded: StreamMessage[] = [];

    for (const item of data.events) {
      const payload = await decodeEventPayload(this.passphrase, item.string);
      if (payload && shouldEmit(mode, payload)) {
        decoded.push({ ...item, decoded: payload });
      }
    }

    return decoded;
  }

  listenStreamEvents(
    path: string,
    onMessage: (message: StreamMessage) => void,
    options?: ListenOptions,
  ): () => void {
    const mode = options?.mode ?? "both";
    const normalizedPath = this.normalize(path);

    const sse = new ResilientSse({
      urlFactory: (cursor) => {
        const search = new URLSearchParams({
          transport: "sse",
          after: String(cursor),
        });
        return this.streamUrl(normalizedPath, search);
      },
      initialCursor: options?.after ?? 0,
      heartbeatTimeoutMs: options?.heartbeatTimeoutMs ?? 30_000,
      reconnectBaseMs: options?.reconnectBaseMs ?? 1_000,
      reconnectMaxMs: options?.reconnectMaxMs ?? 15_000,
      onStatus: options?.onStatus,
      onMessage: async (event) => {
        const payload = await decodeEventPayload(this.passphrase, event.string);
        if (!payload || !shouldEmit(mode, payload)) {
          return;
        }

        onMessage({ ...event, decoded: payload });
      },
    });

    sse.start();
    return () => sse.stop();
  }

  listenStream(
    path: string,
    onMessage: (value: StreamValue) => void,
    options?: ListenOptions,
  ): () => void {
    return this.listenStreamEvents(
      path,
      (event) => {
        onMessage(event.decoded.value);
      },
      options,
    );
  }

  async setObject(path: string, value: unknown): Promise<void> {
    const envelope = await encryptJson(this.passphrase, value);
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      throw new Error(`Failed to set object (${response.status})`);
    }
  }

  async getObject<T>(path: string): Promise<T | null> {
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)));
    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to get object (${response.status})`);
    }

    const data = (await response.json()) as { value: CipherEnvelope };
    if (!isCipherEnvelope(data.value)) {
      return null;
    }

    return decryptJson<T>(this.passphrase, data.value);
  }

  async updateObject<T>(
    path: string,
    updaterOrPatch: ((current: T | null) => T) | ObjectPatch,
  ): Promise<T> {
    const current = await this.getObject<T>(path);
    const next =
      typeof updaterOrPatch === "function"
        ? updaterOrPatch(current)
        : (applyObjectPatch(current, updaterOrPatch) as T);
    await this.setObject(path, next);
    return next;
  }

  async removeObject(path: string): Promise<void> {
    await this.setObject(path, { __streambin_deleted: true });
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete object (${response.status})`);
    }
  }

  listenObject<T>(path: string, onValue: (value: T | null) => void, options?: Omit<ListenOptions, "mode">): () => void {
    const objectPath = normalizePath(path);
    const streamPath = objectUpdateStreamPath(objectPath);

    return this.listenStreamEvents(
      streamPath,
      (event) => {
        if (event.decoded.type !== "json") {
          return;
        }

        const value = event.decoded.value as T;
        if (value && typeof value === "object" && "__streambin_deleted" in (value as object)) {
          onValue(null);
          return;
        }

        onValue(value);
      },
      {
        ...options,
        mode: "json",
      },
    );
  }

  async hasObjectChangedSince(path: string, timestamp: number): Promise<boolean> {
    const streamPath = objectUpdateStreamPath(normalizePath(path));
    const events = await this.getStream(streamPath, {
      after: timestamp,
      limit: 1,
      mode: "json",
    });

    return events.length > 0;
  }
}

// Backward-compatible exports during rename transition.
export const StreamboxClient = StreambinClient;
export type StreamboxClientOptions = StreambinClientOptions;
