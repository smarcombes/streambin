// src/index.ts
import {
  decryptJson,
  encryptJson,
  isCipherEnvelope
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
