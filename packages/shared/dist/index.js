// src/index.ts
var STREAM_TTL_SECONDS = 60 * 60 * 24 * 3;
var DOC_TTL_SECONDS = 60 * 60 * 24 * 3;
var SSE_MAX_DURATION_SECONDS = 800;
var SSE_RECONNECT_AT_SECONDS = 790;
var SSE_PING_INTERVAL_MS = 2e4;
function normalizePath(path) {
  const parts = Array.isArray(path) ? path : path.split("/");
  return parts.map((p) => p.trim()).filter(Boolean).join("/");
}
function streamKey(namespace, path) {
  return `sb:stream:${namespace}:${normalizePath(path)}`;
}
function docKey(namespace, path) {
  return `sb:doc:${namespace}:${normalizePath(path)}`;
}
function fnv1aHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function objectUpdateStreamPath(objectPath) {
  const normalized = normalizePath(objectPath);
  return `_docs/${fnv1aHash(normalized)}-${normalized.replaceAll("/", "_")}`;
}
export {
  DOC_TTL_SECONDS,
  SSE_MAX_DURATION_SECONDS,
  SSE_PING_INTERVAL_MS,
  SSE_RECONNECT_AT_SECONDS,
  STREAM_TTL_SECONDS,
  docKey,
  fnv1aHash,
  normalizePath,
  objectUpdateStreamPath,
  streamKey
};
