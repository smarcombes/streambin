import {
  CipherEnvelope,
  DEFAULT_FILE_CHUNK_SIZE_BYTES,
  FileStreamDecryptor,
  FileStreamEncryptor,
  GCM_TAG_SIZE,
  SBF1_HEADER_SIZE,
  SBF2_HEADER_SIZE,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  isCipherEnvelope,
  readEncryptedFileFormat,
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

export type UploadableFileStream = {
  size: number;
  stream: () => ReadableStream<Uint8Array>;
  contentType?: string;
};

export type UploadableFile = Blob | ArrayBuffer | Uint8Array | UploadableFileStream;

export type UploadFileOptions = {
  contentType?: string;
  encrypted?: boolean;
  chunkSize?: number;
  multipart?: {
    enabled?: boolean;
    partSize?: number;
  };
};

type PreparedSingleUpload = {
  mode: "single";
  fileId: string;
  key: string;
  method: "PUT";
  url: string;
  contentType: string;
  expiresIn: number;
  publicUrl: string;
};

type PreparedMultipartUpload = {
  mode: "multipart";
  fileId: string;
  key: string;
  uploadId: string;
  contentType: string;
  partSize: number;
  parts: Array<{ partNumber: number; url: string }>;
  expiresIn: number;
  publicUrl: string;
};

type PreparedFileUpload = PreparedSingleUpload | PreparedMultipartUpload;

export type UploadedFile = {
  fileId: string;
  key: string;
  publicUrl: string;
  contentType: string;
  originalContentType: string;
  encrypted: boolean;
  size: number;
  updatedAt: number;
};

export type FileMetadata = {
  fileId: string;
  key: string;
  publicUrl: string;
  contentType: string;
  originalContentType: string;
  encrypted: boolean;
  size: number;
  updatedAt: number;
};

export type DownloadedFile = {
  bytes: Uint8Array;
  contentType: string;
  encrypted: boolean;
  metadata: FileMetadata;
};

export type DownloadedFileStream = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  encrypted: boolean;
  metadata: FileMetadata;
};


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

function getSourceSize(source: UploadableFile): number {
  if (source instanceof Uint8Array) {
    return source.byteLength;
  }
  if (source instanceof ArrayBuffer) {
    return source.byteLength;
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.size;
  }
  return source.size;
}

function getSourceContentType(source: UploadableFile, explicit?: string): string {
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  if (typeof Blob !== "undefined" && source instanceof Blob && source.type) {
    return source.type;
  }
  if (typeof source === "object" && source !== null && !(source instanceof Uint8Array) && !(source instanceof ArrayBuffer) && "contentType" in source && source.contentType) {
    return source.contentType;
  }
  return "application/octet-stream";
}

function openSourceStream(source: UploadableFile): ReadableStream<Uint8Array> {
  if (source instanceof Uint8Array) {
    const bytes = source;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      },
    });
  }
  if (source instanceof ArrayBuffer) {
    const bytes = new Uint8Array(source);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      },
    });
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.stream() as ReadableStream<Uint8Array>;
  }
  return source.stream();
}

class FixedSizeChunkReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private carry: Uint8Array | null = null;
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async readExactly(n: number): Promise<Uint8Array | null> {
    if (n === 0) {
      return new Uint8Array(0);
    }
    const pieces: Uint8Array[] = [];
    let collected = 0;

    if (this.carry && this.carry.length > 0) {
      const take = Math.min(this.carry.length, n);
      pieces.push(this.carry.subarray(0, take));
      collected += take;
      this.carry = take < this.carry.length ? this.carry.subarray(take) : null;
    }

    while (collected < n && !this.done) {
      const result = await this.reader.read();
      if (result.done) {
        this.done = true;
        break;
      }
      const value = result.value;
      const take = Math.min(value.length, n - collected);
      pieces.push(value.subarray(0, take));
      collected += take;
      if (take < value.length) {
        this.carry = value.subarray(take);
      }
    }

    if (collected === 0) {
      return null;
    }
    if (collected !== n) {
      throw new Error(`Stream ended early: wanted ${n} bytes, got ${collected}`);
    }
    if (pieces.length === 1) {
      return pieces[0];
    }
    const out = new Uint8Array(collected);
    let offset = 0;
    for (const piece of pieces) {
      out.set(piece, offset);
      offset += piece.byteLength;
    }
    return out;
  }

  async readUpTo(n: number): Promise<Uint8Array | null> {
    if (n === 0) {
      return new Uint8Array(0);
    }
    if (this.carry && this.carry.length > 0) {
      const take = Math.min(this.carry.length, n);
      const result = this.carry.subarray(0, take);
      this.carry = take < this.carry.length ? this.carry.subarray(take) : null;
      return result;
    }
    if (this.done) {
      return null;
    }
    const result = await this.reader.read();
    if (result.done) {
      this.done = true;
      return null;
    }
    const value = result.value;
    if (value.length <= n) {
      return value;
    }
    this.carry = value.subarray(n);
    return value.subarray(0, n);
  }

  async close(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // ignore
    }
    try {
      this.reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

async function materializeBytes(source: UploadableFile): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  const size = source.size;
  const stream = source.stream();
  const reader = stream.getReader();
  const pieces: Uint8Array[] = [];
  let collected = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    pieces.push(result.value);
    collected += result.value.byteLength;
  }
  if (collected !== size) {
    throw new Error(`Source stream size mismatch (declared ${size}, read ${collected})`);
  }
  const out = new Uint8Array(collected);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.byteLength;
  }
  return out;
}

function computeEncryptedMultipartSize(originalSize: number, chunkSize: number): number {
  const partCount = Math.max(1, Math.ceil(originalSize / chunkSize));
  return SBF2_HEADER_SIZE + originalSize + partCount * GCM_TAG_SIZE;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesToBodyInit(bytes: Uint8Array): BodyInit {
  return bytesToArrayBuffer(bytes);
}

function bytesToReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

async function drainReader(reader: FixedSizeChunkReader): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const piece = await reader.readUpTo(64 * 1024);
    if (!piece) {
      break;
    }
    pieces.push(piece);
    total += piece.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.byteLength;
  }
  return out;
}

function readerToStream(reader: FixedSizeChunkReader): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const piece = await reader.readUpTo(64 * 1024);
        if (!piece) {
          await reader.close();
          controller.close();
          return;
        }
        controller.enqueue(piece);
      } catch (err) {
        await reader.close();
        controller.error(err);
      }
    },
    async cancel() {
      await reader.close();
    },
  });
}

function concatStreams(
  first: ReadableStream<Uint8Array>,
  second: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  let firstReader: ReadableStreamDefaultReader<Uint8Array> | null = first.getReader();
  let secondReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (firstReader) {
          const result = await firstReader.read();
          if (!result.done) {
            controller.enqueue(result.value);
            return;
          }
          firstReader.releaseLock();
          firstReader = null;
          secondReader = second.getReader();
        }
        if (!secondReader) {
          controller.close();
          return;
        }
        const result = await secondReader.read();
        if (result.done) {
          secondReader.releaseLock();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      if (firstReader) {
        await firstReader.cancel().catch(() => {});
      }
      if (secondReader) {
        await secondReader.cancel().catch(() => {});
      }
    },
  });
}


async function decryptSbf2Bytes(passphrase: string, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < SBF2_HEADER_SIZE) {
    throw new Error("Blob too short for SBF2 header");
  }
  const decryptor = new FileStreamDecryptor(passphrase);
  const info = decryptor.consumeHeader(blob.subarray(0, SBF2_HEADER_SIZE));
  const out = new Uint8Array(info.totalSize);
  let cursorIn = SBF2_HEADER_SIZE;
  let cursorOut = 0;
  let remaining = info.totalSize;

  if (remaining === 0) {
    if (cursorIn + GCM_TAG_SIZE > blob.length) {
      throw new Error("SBF2 blob too short for final empty chunk");
    }
    const tag = blob.subarray(cursorIn, cursorIn + GCM_TAG_SIZE);
    const plaintext = await decryptor.decryptChunk(tag, true);
    if (plaintext.byteLength !== 0) {
      throw new Error("Unexpected non-empty plaintext for zero-length file");
    }
    return out;
  }

  while (remaining > 0) {
    const plaintextSize = Math.min(remaining, info.chunkSize);
    const ciphertextSize = plaintextSize + GCM_TAG_SIZE;
    if (cursorIn + ciphertextSize > blob.length) {
      throw new Error("SBF2 blob ended early in chunk body");
    }
    const ciphertext = blob.subarray(cursorIn, cursorIn + ciphertextSize);
    const isLast = remaining <= info.chunkSize;
    const plaintext = await decryptor.decryptChunk(ciphertext, isLast);
    out.set(plaintext, cursorOut);
    cursorOut += plaintext.byteLength;
    remaining -= plaintext.byteLength;
    cursorIn += ciphertextSize;
  }
  return out;
}

function createSbf2DecryptStream(
  passphrase: string,
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = new FixedSizeChunkReader(source);
  const decryptor = new FileStreamDecryptor(passphrase);
  let initialized = false;
  let chunkSize = 0;
  let remaining = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!initialized) {
          const header = await reader.readExactly(SBF2_HEADER_SIZE);
          if (!header) {
            throw new Error("Empty stream while expecting SBF2 header");
          }
          const info = decryptor.consumeHeader(header);
          chunkSize = info.chunkSize;
          remaining = info.totalSize;
          initialized = true;

          if (remaining === 0) {
            const tag = await reader.readExactly(GCM_TAG_SIZE);
            if (!tag) {
              throw new Error("Stream ended before final empty chunk tag");
            }
            await decryptor.decryptChunk(tag, true);
            await reader.close();
            controller.close();
            return;
          }
        }

        if (remaining <= 0) {
          await reader.close();
          controller.close();
          return;
        }

        const plaintextSize = Math.min(remaining, chunkSize);
        const ciphertextSize = plaintextSize + GCM_TAG_SIZE;
        const ciphertext = await reader.readExactly(ciphertextSize);
        if (!ciphertext) {
          throw new Error("Stream ended early in chunk body");
        }
        const isLast = remaining <= chunkSize;
        const plaintext = await decryptor.decryptChunk(ciphertext, isLast);
        remaining -= plaintext.byteLength;
        controller.enqueue(plaintext);
        if (isLast) {
          await reader.close();
          controller.close();
        }
      } catch (err) {
        await reader.close();
        controller.error(err);
      }
    },
    async cancel() {
      await reader.close();
    },
  });
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

  private fileUrl(path: string): string {
    return `${this.baseUrl}/api/files/${encodeURIComponent(this.namespace)}/${path}`;
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

  async uploadFile(path: string, file: UploadableFile, options?: UploadFileOptions): Promise<UploadedFile> {
    const normalizedPath = this.normalize(path);
    const originalSize = getSourceSize(file);
    const originalContentType = getSourceContentType(file, options?.contentType);
    const encrypted = options?.encrypted !== false;

    if (!encrypted) {
      return this.uploadFilePlaintext(normalizedPath, file, originalSize, originalContentType, options?.multipart);
    }

    const chunkSize = options?.chunkSize ?? DEFAULT_FILE_CHUNK_SIZE_BYTES;
    if (chunkSize <= 0 || !Number.isFinite(chunkSize)) {
      throw new Error("chunkSize must be a positive number");
    }

    const forceSingle = options?.multipart?.enabled === false;
    const forceMultipart = options?.multipart?.enabled === true;
    const fitsInSingle = originalSize <= chunkSize;

    if (forceSingle || (fitsInSingle && !forceMultipart)) {
      return this.uploadFileEncryptedSingle(normalizedPath, file, originalSize, originalContentType);
    }

    return this.uploadFileEncryptedMultipart(normalizedPath, file, originalSize, originalContentType, chunkSize);
  }

  private async uploadFilePlaintext(
    normalizedPath: string,
    file: UploadableFile,
    originalSize: number,
    contentType: string,
    multipart?: { enabled?: boolean; partSize?: number },
  ): Promise<UploadedFile> {
    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare",
        size: originalSize,
        contentType,
        encrypted: false,
        originalContentType: contentType,
        multipart,
      }),
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare file upload (${prepareResponse.status})`);
    }

    const prepared = (await prepareResponse.json()) as PreparedFileUpload;

    if (prepared.mode === "single") {
      const body = await materializeBytes(file);
      const putResponse = await this.fetchImpl(prepared.url, {
        method: prepared.method,
        headers: {
          "Content-Type": prepared.contentType,
        },
        body: bytesToBodyInit(body),
      });
      if (!putResponse.ok) {
        throw new Error(`Failed to upload file bytes (${putResponse.status})`);
      }

      return this.completeUpload(normalizedPath, {
        action: "completeSingle",
        fileId: prepared.fileId,
        key: prepared.key,
        contentType: prepared.contentType,
        originalContentType: contentType,
        encrypted: false,
        size: originalSize,
      });
    }

    const allBytes = await materializeBytes(file);
    const uploadedParts: Array<{ partNumber: number; eTag: string }> = [];
    for (const part of prepared.parts) {
      const start = (part.partNumber - 1) * prepared.partSize;
      const end = Math.min(start + prepared.partSize, originalSize);
      const chunk = allBytes.subarray(start, end);
      const uploadResponse = await this.fetchImpl(part.url, {
        method: "PUT",
        body: bytesToBodyInit(chunk),
      });
      if (!uploadResponse.ok) {
        throw new Error(`Failed multipart upload for part ${part.partNumber} (${uploadResponse.status})`);
      }
      const eTag = uploadResponse.headers.get("etag");
      if (!eTag) {
        throw new Error(`Missing ETag for multipart part ${part.partNumber}`);
      }
      uploadedParts.push({ partNumber: part.partNumber, eTag });
    }

    return this.completeUpload(normalizedPath, {
      action: "completeMultipart",
      fileId: prepared.fileId,
      key: prepared.key,
      uploadId: prepared.uploadId,
      contentType: prepared.contentType,
      originalContentType: contentType,
      encrypted: false,
      size: originalSize,
      parts: uploadedParts,
    });
  }

  private async uploadFileEncryptedSingle(
    normalizedPath: string,
    file: UploadableFile,
    originalSize: number,
    originalContentType: string,
  ): Promise<UploadedFile> {
    const plaintext = await materializeBytes(file);
    const ciphertext = await encryptBytes(this.passphrase, plaintext);
    const ciphertextSize = ciphertext.byteLength;

    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare",
        size: ciphertextSize,
        contentType: "application/octet-stream",
        encrypted: true,
        originalContentType,
        multipart: { enabled: false },
      }),
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare encrypted upload (${prepareResponse.status})`);
    }

    const prepared = (await prepareResponse.json()) as PreparedFileUpload;
    if (prepared.mode !== "single") {
      throw new Error("Server returned multipart mode for single encrypted upload");
    }

    const putResponse = await this.fetchImpl(prepared.url, {
      method: prepared.method,
      headers: {
        "Content-Type": prepared.contentType,
      },
      body: bytesToBodyInit(ciphertext),
    });
    if (!putResponse.ok) {
      throw new Error(`Failed to upload encrypted bytes (${putResponse.status})`);
    }

    return this.completeUpload(normalizedPath, {
      action: "completeSingle",
      fileId: prepared.fileId,
      key: prepared.key,
      contentType: "application/octet-stream",
      originalContentType,
      encrypted: true,
      size: ciphertextSize,
    });
  }

  private async uploadFileEncryptedMultipart(
    normalizedPath: string,
    file: UploadableFile,
    originalSize: number,
    originalContentType: string,
    chunkSize: number,
  ): Promise<UploadedFile> {
    const partCount = Math.max(1, Math.ceil(originalSize / chunkSize));
    const ciphertextSize = computeEncryptedMultipartSize(originalSize, chunkSize);

    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare",
        size: originalSize,
        contentType: "application/octet-stream",
        encrypted: true,
        originalContentType,
        multipart: { enabled: true, partSize: chunkSize },
      }),
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare encrypted multipart upload (${prepareResponse.status})`);
    }

    const prepared = (await prepareResponse.json()) as PreparedFileUpload;
    if (prepared.mode !== "multipart") {
      throw new Error("Server returned single mode for multipart encrypted upload");
    }
    if (prepared.parts.length !== partCount) {
      throw new Error(
        `Server returned ${prepared.parts.length} part URLs but client expects ${partCount}`,
      );
    }

    const encryptor = new FileStreamEncryptor(this.passphrase, originalSize, chunkSize);
    const header = encryptor.initHeader();
    const reader = new FixedSizeChunkReader(openSourceStream(file));
    const uploadedParts: Array<{ partNumber: number; eTag: string }> = [];

    try {
      let bytesRead = 0;
      for (let i = 0; i < partCount; i += 1) {
        const remaining = originalSize - bytesRead;
        const plaintextSize = Math.min(remaining, chunkSize);
        const isLast = i === partCount - 1;
        const plaintext = await reader.readExactly(plaintextSize);
        if (!plaintext) {
          throw new Error("Source stream ended before declared size");
        }
        const ciphertext = await encryptor.encryptChunk(plaintext, isLast);
        bytesRead += plaintextSize;

        let partBody: Uint8Array;
        if (i === 0) {
          partBody = new Uint8Array(header.byteLength + ciphertext.byteLength);
          partBody.set(header, 0);
          partBody.set(ciphertext, header.byteLength);
        } else {
          partBody = ciphertext;
        }

        const part = prepared.parts[i];
        const uploadResponse = await this.fetchImpl(part.url, {
          method: "PUT",
          body: bytesToBodyInit(partBody),
        });
        if (!uploadResponse.ok) {
          throw new Error(`Failed encrypted multipart upload for part ${part.partNumber} (${uploadResponse.status})`);
        }
        const eTag = uploadResponse.headers.get("etag");
        if (!eTag) {
          throw new Error(`Missing ETag for encrypted multipart part ${part.partNumber}`);
        }
        uploadedParts.push({ partNumber: part.partNumber, eTag });
      }
    } finally {
      await reader.close();
    }

    return this.completeUpload(normalizedPath, {
      action: "completeMultipart",
      fileId: prepared.fileId,
      key: prepared.key,
      uploadId: prepared.uploadId,
      contentType: "application/octet-stream",
      originalContentType,
      encrypted: true,
      size: ciphertextSize,
      parts: uploadedParts,
    });
  }

  private async completeUpload(
    normalizedPath: string,
    body: Record<string, unknown>,
  ): Promise<UploadedFile> {
    const response = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Failed to finalize file upload (${response.status})`);
    }
    return response.json();
  }

  getFileUrl(path: string): string {
    return this.fileUrl(this.normalize(path));
  }

  async getFileMetadata(path: string): Promise<FileMetadata | null> {
    const response = await this.fetchImpl(`${this.fileUrl(this.normalize(path))}?meta=1`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch file metadata (${response.status})`);
    }
    return response.json();
  }

  async downloadFile(path: string): Promise<DownloadedFile | null> {
    const metadata = await this.getFileMetadata(path);
    if (!metadata) {
      return null;
    }

    const response = await this.fetchImpl(metadata.publicUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file body (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());

    if (!metadata.encrypted) {
      return {
        bytes,
        contentType: metadata.contentType,
        encrypted: false,
        metadata,
      };
    }

    const format = readEncryptedFileFormat(bytes);
    if (format === "SBF1") {
      const plaintext = await decryptBytes(this.passphrase, bytes);
      return {
        bytes: plaintext,
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata,
      };
    }
    if (format === "SBF2") {
      const plaintext = await decryptSbf2Bytes(this.passphrase, bytes);
      return {
        bytes: plaintext,
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata,
      };
    }
    throw new Error("File metadata says encrypted but body is not a known encrypted format");
  }

  async downloadFileStream(path: string): Promise<DownloadedFileStream | null> {
    const metadata = await this.getFileMetadata(path);
    if (!metadata) {
      return null;
    }

    const response = await this.fetchImpl(metadata.publicUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file body (${response.status})`);
    }

    if (!metadata.encrypted) {
      if (!response.body) {
        throw new Error("Response body is not a stream");
      }
      return {
        stream: response.body as ReadableStream<Uint8Array>,
        contentType: metadata.contentType,
        encrypted: false,
        metadata,
      };
    }

    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const format = readEncryptedFileFormat(bytes);
      if (format === "SBF1") {
        const plaintext = await decryptBytes(this.passphrase, bytes);
        return {
          stream: bytesToReadableStream(plaintext),
          contentType: metadata.originalContentType || "application/octet-stream",
          encrypted: true,
          metadata,
        };
      }
      if (format === "SBF2") {
        return {
          stream: createSbf2DecryptStream(this.passphrase, bytesToReadableStream(bytes)),
          contentType: metadata.originalContentType || "application/octet-stream",
          encrypted: true,
          metadata,
        };
      }
      throw new Error("Encrypted file is not in a known format");
    }

    const reader = new FixedSizeChunkReader(response.body as ReadableStream<Uint8Array>);
    const magic = await reader.readExactly(4);
    if (!magic) {
      throw new Error("Empty encrypted file body");
    }
    const magicText = new TextDecoder().decode(magic);
    if (magicText === "SBF1") {
      const rest = await drainReader(reader);
      const combined = new Uint8Array(4 + rest.byteLength);
      combined.set(magic, 0);
      combined.set(rest, 4);
      const plaintext = await decryptBytes(this.passphrase, combined);
      return {
        stream: bytesToReadableStream(plaintext),
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata,
      };
    }
    if (magicText === "SBF2") {
      const restHeader = await reader.readExactly(SBF2_HEADER_SIZE - 4);
      if (!restHeader) {
        throw new Error("Stream ended before SBF2 header complete");
      }
      const fullHeader = new Uint8Array(SBF2_HEADER_SIZE);
      fullHeader.set(magic, 0);
      fullHeader.set(restHeader, 4);
      const remainder = readerToStream(reader);
      const combined = concatStreams(bytesToReadableStream(fullHeader), remainder);
      return {
        stream: createSbf2DecryptStream(this.passphrase, combined),
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata,
      };
    }
    throw new Error("Encrypted file is not in a known format");
  }

  async getDecryptedBlobUrl(path: string): Promise<string | null> {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") {
      throw new Error("getDecryptedBlobUrl requires a browser-like runtime with URL.createObjectURL and Blob");
    }
    const downloaded = await this.downloadFile(path);
    if (!downloaded) {
      return null;
    }
    const blob = new Blob([bytesToArrayBuffer(downloaded.bytes)], { type: downloaded.contentType });
    return URL.createObjectURL(blob);
  }

  async deleteFile(path: string): Promise<void> {
    const response = await this.fetchImpl(this.fileUrl(this.normalize(path)), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete file (${response.status})`);
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
