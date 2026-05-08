export const STREAM_TTL_SECONDS = 60 * 60 * 24 * 3;
export const DOC_TTL_SECONDS = 60 * 60 * 24;
export const SSE_MAX_DURATION_SECONDS = 800;
export const SSE_RECONNECT_AT_SECONDS = 790;
export const SSE_PING_INTERVAL_MS = 20_000;

export type StreamEventEnvelope = {
  event: "message";
  id: string;
  timestamp: number;
  string: string;
};

export type StoredDocEnvelope = {
  value: unknown;
  updatedAt: number;
};

export function normalizePath(path: string | string[]): string {
  const parts = Array.isArray(path) ? path : path.split("/");
  return parts.map((p) => p.trim()).filter(Boolean).join("/");
}

export function streamKey(namespace: string, path: string | string[]): string {
  return `sb:stream:${namespace}:${normalizePath(path)}`;
}

export function docKey(namespace: string, path: string | string[]): string {
  return `sb:doc:${namespace}:${normalizePath(path)}`;
}

export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function objectUpdateStreamPath(objectPath: string | string[]): string {
  const normalized = normalizePath(objectPath);
  return `_docs/${fnv1aHash(normalized)}-${normalized.replaceAll("/", "_")}`;
}
