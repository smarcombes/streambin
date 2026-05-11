// src/index.ts
import {
  DEFAULT_FILE_CHUNK_SIZE_BYTES,
  FileStreamDecryptor,
  FileStreamEncryptor,
  GCM_TAG_SIZE,
  SBF2_HEADER_SIZE,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  isCipherEnvelope,
  readEncryptedFileFormat
} from "@streambin/crypto";
import { objectUpdateStreamPath, normalizePath } from "@streambin/shared";
function isTaggedPayload(value) {
  return value !== null && typeof value === "object" && "t" in value && "d" in value;
}
function isOpPayload(value) {
  return value !== null && typeof value === "object" && "op" in value && value.op === "set" && "value" in value && isCipherEnvelope(value.value);
}
function defaultFetch(input, init) {
  return fetch(input, init);
}
function parseCipherEnvelope(value) {
  if (isCipherEnvelope(value)) {
    return value;
  }
  return null;
}
function shouldEmit(mode, payload) {
  if (mode === "both") {
    return true;
  }
  return payload.type === mode;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepClone(v);
    }
    return out;
  }
  return value;
}
function setByPath(target, dottedPath, value) {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }
  let node = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    const existing = node[seg];
    if (!isPlainObject(existing)) {
      node[seg] = {};
    }
    node = node[seg];
  }
  node[segments[segments.length - 1]] = value;
}
function applyObjectPatch(current, patch) {
  const base = isPlainObject(current) ? deepClone(current) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key.includes(".")) {
      setByPath(base, key, value);
      continue;
    }
    base[key] = value;
  }
  return base;
}
async function encodeMessage(passphrase, value) {
  const envelope = await encryptJson(passphrase, { t: "m", d: value });
  return JSON.stringify(envelope);
}
async function encodeJson(passphrase, value) {
  const envelope = await encryptJson(passphrase, { t: "j", d: value });
  return JSON.stringify(envelope);
}
async function decodeEventPayload(passphrase, payload) {
  let parsed;
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
    const decoded = await decryptJson(passphrase, envelope);
    if (isTaggedPayload(decoded)) {
      const tagged = decoded;
      if (tagged.t === "m") {
        return { type: "message", value: tagged.d };
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
function getSourceSize(source) {
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
function getSourceContentType(source, explicit) {
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
function openSourceStream(source) {
  if (source instanceof Uint8Array) {
    const bytes = source;
    return new ReadableStream({
      start(controller) {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      }
    });
  }
  if (source instanceof ArrayBuffer) {
    const bytes = new Uint8Array(source);
    return new ReadableStream({
      start(controller) {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      }
    });
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.stream();
  }
  return source.stream();
}
var FixedSizeChunkReader = class {
  reader;
  carry = null;
  done = false;
  constructor(stream) {
    this.reader = stream.getReader();
  }
  async readExactly(n) {
    if (n === 0) {
      return new Uint8Array(0);
    }
    const pieces = [];
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
  async readUpTo(n) {
    if (n === 0) {
      return new Uint8Array(0);
    }
    if (this.carry && this.carry.length > 0) {
      const take = Math.min(this.carry.length, n);
      const result2 = this.carry.subarray(0, take);
      this.carry = take < this.carry.length ? this.carry.subarray(take) : null;
      return result2;
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
  async close() {
    try {
      await this.reader.cancel();
    } catch {
    }
    try {
      this.reader.releaseLock();
    } catch {
    }
  }
};
async function materializeBytes(source) {
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
  const pieces = [];
  let collected = 0;
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
function computeEncryptedMultipartSize(originalSize, chunkSize) {
  const partCount = Math.max(1, Math.ceil(originalSize / chunkSize));
  return SBF2_HEADER_SIZE + originalSize + partCount * GCM_TAG_SIZE;
}
function bytesToArrayBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}
function bytesToBodyInit(bytes) {
  return bytesToArrayBuffer(bytes);
}
function bytesToReadableStream(bytes) {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    }
  });
}
async function drainReader(reader) {
  const pieces = [];
  let total = 0;
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
function readerToStream(reader) {
  return new ReadableStream({
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
    }
  });
}
function concatStreams(first, second) {
  let firstReader = first.getReader();
  let secondReader = null;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (firstReader) {
          const result2 = await firstReader.read();
          if (!result2.done) {
            controller.enqueue(result2.value);
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
        await firstReader.cancel().catch(() => {
        });
      }
      if (secondReader) {
        await secondReader.cancel().catch(() => {
        });
      }
    }
  });
}
async function decryptSbf2Bytes(passphrase, blob) {
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
function createSbf2DecryptStream(passphrase, source) {
  const reader = new FixedSizeChunkReader(source);
  const decryptor = new FileStreamDecryptor(passphrase);
  let initialized = false;
  let chunkSize = 0;
  let remaining = 0;
  return new ReadableStream({
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
    }
  });
}
var ResilientSse = class {
  urlFactory;
  heartbeatTimeoutMs;
  reconnectBaseMs;
  reconnectMaxMs;
  onMessage;
  onStatus;
  cursor;
  source = null;
  reconnectTimer = null;
  heartbeatTimer = null;
  backoff = 0;
  destroyed = false;
  paused = false;
  constructor(args) {
    this.urlFactory = args.urlFactory;
    this.cursor = args.initialCursor;
    this.heartbeatTimeoutMs = args.heartbeatTimeoutMs;
    this.reconnectBaseMs = args.reconnectBaseMs;
    this.reconnectMaxMs = args.reconnectMaxMs;
    this.onMessage = args.onMessage;
    this.onStatus = args.onStatus;
  }
  start() {
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
  stop() {
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
  handleOffline = () => {
    this.paused = true;
    this.setConnected(false);
    this.clearReconnect();
    this.closeSource();
  };
  handleOnline = () => {
    this.paused = false;
    this.connect();
  };
  handleVisibilityChange = () => {
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
  setConnected(connected) {
    this.onStatus?.(connected);
  }
  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  clearTimers() {
    this.clearReconnect();
    this.clearHeartbeat();
  }
  scheduleReconnect(delay) {
    if (this.destroyed || this.paused) {
      return;
    }
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
  resetHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.setConnected(false);
      this.closeSource();
      this.scheduleReconnect(this.nextBackoff());
    }, this.heartbeatTimeoutMs);
  }
  nextBackoff() {
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.backoff, this.reconnectMaxMs);
    this.backoff += 1;
    return delay;
  }
  closeSource() {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }
  connect() {
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
      const message = JSON.parse(event.data);
      this.cursor = Math.max(this.cursor, message.timestamp);
      void this.onMessage(message);
    };
    source.addEventListener("ping", () => {
      this.resetHeartbeat();
    });
    source.addEventListener("reconnect", (event) => {
      this.resetHeartbeat();
      try {
        const data = JSON.parse(event.data);
        if (typeof data.cursor === "number") {
          this.cursor = Math.max(this.cursor, data.cursor);
        }
      } catch {
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
};
var StreambinClient = class {
  baseUrl;
  namespace;
  passphrase;
  fetchImpl;
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.namespace = options.namespace;
    this.passphrase = options.passphrase;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }
  streamUrl(path, search) {
    const suffix = search ? `?${search.toString()}` : "";
    return `${this.baseUrl}/api/streams/${encodeURIComponent(this.namespace)}/${path}${suffix}`;
  }
  docUrl(path) {
    return `${this.baseUrl}/api/docs/${encodeURIComponent(this.namespace)}/${path}`;
  }
  fileUrl(path) {
    return `${this.baseUrl}/api/files/${encodeURIComponent(this.namespace)}/${path}`;
  }
  normalize(path) {
    return normalizePath(path).split("/").map((part) => encodeURIComponent(part)).join("/");
  }
  async appendMessage(path, message) {
    const ciphertext = await encodeMessage(this.passphrase, message);
    const response = await this.fetchImpl(this.streamUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: ciphertext
    });
    if (!response.ok) {
      throw new Error(`Failed to append stream message (${response.status})`);
    }
    return response.json();
  }
  async appendJson(path, value) {
    const ciphertext = await encodeJson(this.passphrase, value);
    const response = await this.fetchImpl(this.streamUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: ciphertext
    });
    if (!response.ok) {
      throw new Error(`Failed to append stream json (${response.status})`);
    }
    return response.json();
  }
  async getStream(path, options) {
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
    const data = await response.json();
    const mode = options?.mode ?? "both";
    const decoded = [];
    for (const item of data.events) {
      const payload = await decodeEventPayload(this.passphrase, item.string);
      if (payload && shouldEmit(mode, payload)) {
        decoded.push({ ...item, decoded: payload });
      }
    }
    return decoded;
  }
  listenStreamEvents(path, onMessage, options) {
    const mode = options?.mode ?? "both";
    const normalizedPath = this.normalize(path);
    const sse = new ResilientSse({
      urlFactory: (cursor) => {
        const search = new URLSearchParams({
          transport: "sse",
          after: String(cursor)
        });
        return this.streamUrl(normalizedPath, search);
      },
      initialCursor: options?.after ?? 0,
      heartbeatTimeoutMs: options?.heartbeatTimeoutMs ?? 3e4,
      reconnectBaseMs: options?.reconnectBaseMs ?? 1e3,
      reconnectMaxMs: options?.reconnectMaxMs ?? 15e3,
      onStatus: options?.onStatus,
      onMessage: async (event) => {
        const payload = await decodeEventPayload(this.passphrase, event.string);
        if (!payload || !shouldEmit(mode, payload)) {
          return;
        }
        onMessage({ ...event, decoded: payload });
      }
    });
    sse.start();
    return () => sse.stop();
  }
  listenStream(path, onMessage, options) {
    return this.listenStreamEvents(
      path,
      (event) => {
        onMessage(event.decoded.value);
      },
      options
    );
  }
  async setObject(path, value) {
    const envelope = await encryptJson(this.passphrase, value);
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(envelope)
    });
    if (!response.ok) {
      throw new Error(`Failed to set object (${response.status})`);
    }
  }
  async getObject(path) {
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to get object (${response.status})`);
    }
    const data = await response.json();
    if (!isCipherEnvelope(data.value)) {
      return null;
    }
    return decryptJson(this.passphrase, data.value);
  }
  async updateObject(path, updaterOrPatch) {
    const current = await this.getObject(path);
    const next = typeof updaterOrPatch === "function" ? updaterOrPatch(current) : applyObjectPatch(current, updaterOrPatch);
    await this.setObject(path, next);
    return next;
  }
  async removeObject(path) {
    await this.setObject(path, { __streambin_deleted: true });
    const response = await this.fetchImpl(this.docUrl(this.normalize(path)), {
      method: "DELETE"
    });
    if (!response.ok) {
      throw new Error(`Failed to delete object (${response.status})`);
    }
  }
  async uploadFile(path, file, options) {
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
    if (forceSingle || fitsInSingle && !forceMultipart) {
      return this.uploadFileEncryptedSingle(normalizedPath, file, originalSize, originalContentType);
    }
    return this.uploadFileEncryptedMultipart(normalizedPath, file, originalSize, originalContentType, chunkSize);
  }
  async uploadFilePlaintext(normalizedPath, file, originalSize, contentType, multipart) {
    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "prepare",
        size: originalSize,
        contentType,
        encrypted: false,
        originalContentType: contentType,
        multipart
      })
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare file upload (${prepareResponse.status})`);
    }
    const prepared = await prepareResponse.json();
    if (prepared.mode === "single") {
      const body = await materializeBytes(file);
      const putResponse = await this.fetchImpl(prepared.url, {
        method: prepared.method,
        headers: {
          "Content-Type": prepared.contentType
        },
        body: bytesToBodyInit(body)
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
        size: originalSize
      });
    }
    const allBytes = await materializeBytes(file);
    const uploadedParts = [];
    for (const part of prepared.parts) {
      const start = (part.partNumber - 1) * prepared.partSize;
      const end = Math.min(start + prepared.partSize, originalSize);
      const chunk = allBytes.subarray(start, end);
      const uploadResponse = await this.fetchImpl(part.url, {
        method: "PUT",
        body: bytesToBodyInit(chunk)
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
      parts: uploadedParts
    });
  }
  async uploadFileEncryptedSingle(normalizedPath, file, originalSize, originalContentType) {
    const plaintext = await materializeBytes(file);
    const ciphertext = await encryptBytes(this.passphrase, plaintext);
    const ciphertextSize = ciphertext.byteLength;
    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "prepare",
        size: ciphertextSize,
        contentType: "application/octet-stream",
        encrypted: true,
        originalContentType,
        multipart: { enabled: false }
      })
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare encrypted upload (${prepareResponse.status})`);
    }
    const prepared = await prepareResponse.json();
    if (prepared.mode !== "single") {
      throw new Error("Server returned multipart mode for single encrypted upload");
    }
    const putResponse = await this.fetchImpl(prepared.url, {
      method: prepared.method,
      headers: {
        "Content-Type": prepared.contentType
      },
      body: bytesToBodyInit(ciphertext)
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
      size: ciphertextSize
    });
  }
  async uploadFileEncryptedMultipart(normalizedPath, file, originalSize, originalContentType, chunkSize) {
    const partCount = Math.max(1, Math.ceil(originalSize / chunkSize));
    const ciphertextSize = computeEncryptedMultipartSize(originalSize, chunkSize);
    const prepareResponse = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "prepare",
        size: originalSize,
        contentType: "application/octet-stream",
        encrypted: true,
        originalContentType,
        multipart: { enabled: true, partSize: chunkSize }
      })
    });
    if (!prepareResponse.ok) {
      throw new Error(`Failed to prepare encrypted multipart upload (${prepareResponse.status})`);
    }
    const prepared = await prepareResponse.json();
    if (prepared.mode !== "multipart") {
      throw new Error("Server returned single mode for multipart encrypted upload");
    }
    if (prepared.parts.length !== partCount) {
      throw new Error(
        `Server returned ${prepared.parts.length} part URLs but client expects ${partCount}`
      );
    }
    const encryptor = new FileStreamEncryptor(this.passphrase, originalSize, chunkSize);
    const header = encryptor.initHeader();
    const reader = new FixedSizeChunkReader(openSourceStream(file));
    const uploadedParts = [];
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
        let partBody;
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
          body: bytesToBodyInit(partBody)
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
      parts: uploadedParts
    });
  }
  async completeUpload(normalizedPath, body) {
    const response = await this.fetchImpl(this.fileUrl(normalizedPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Failed to finalize file upload (${response.status})`);
    }
    return response.json();
  }
  getFileUrl(path) {
    return this.fileUrl(this.normalize(path));
  }
  async getFileMetadata(path) {
    const response = await this.fetchImpl(`${this.fileUrl(this.normalize(path))}?meta=1`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch file metadata (${response.status})`);
    }
    return response.json();
  }
  async downloadFile(path) {
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
        metadata
      };
    }
    const format = readEncryptedFileFormat(bytes);
    if (format === "SBF1") {
      const plaintext = await decryptBytes(this.passphrase, bytes);
      return {
        bytes: plaintext,
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata
      };
    }
    if (format === "SBF2") {
      const plaintext = await decryptSbf2Bytes(this.passphrase, bytes);
      return {
        bytes: plaintext,
        contentType: metadata.originalContentType || "application/octet-stream",
        encrypted: true,
        metadata
      };
    }
    throw new Error("File metadata says encrypted but body is not a known encrypted format");
  }
  async downloadFileStream(path) {
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
        stream: response.body,
        contentType: metadata.contentType,
        encrypted: false,
        metadata
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
          metadata
        };
      }
      if (format === "SBF2") {
        return {
          stream: createSbf2DecryptStream(this.passphrase, bytesToReadableStream(bytes)),
          contentType: metadata.originalContentType || "application/octet-stream",
          encrypted: true,
          metadata
        };
      }
      throw new Error("Encrypted file is not in a known format");
    }
    const reader = new FixedSizeChunkReader(response.body);
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
        metadata
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
        metadata
      };
    }
    throw new Error("Encrypted file is not in a known format");
  }
  async getDecryptedBlobUrl(path) {
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
  async deleteFile(path) {
    const response = await this.fetchImpl(this.fileUrl(this.normalize(path)), {
      method: "DELETE"
    });
    if (!response.ok) {
      throw new Error(`Failed to delete file (${response.status})`);
    }
  }
  listenObject(path, onValue, options) {
    const objectPath = normalizePath(path);
    const streamPath = objectUpdateStreamPath(objectPath);
    return this.listenStreamEvents(
      streamPath,
      (event) => {
        if (event.decoded.type !== "json") {
          return;
        }
        const value = event.decoded.value;
        if (value && typeof value === "object" && "__streambin_deleted" in value) {
          onValue(null);
          return;
        }
        onValue(value);
      },
      {
        ...options,
        mode: "json"
      }
    );
  }
  async hasObjectChangedSince(path, timestamp) {
    const streamPath = objectUpdateStreamPath(normalizePath(path));
    const events = await this.getStream(streamPath, {
      after: timestamp,
      limit: 1,
      mode: "json"
    });
    return events.length > 0;
  }
};
var StreamboxClient = StreambinClient;
export {
  StreambinClient,
  StreamboxClient
};
