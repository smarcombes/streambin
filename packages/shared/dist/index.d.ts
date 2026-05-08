declare const STREAM_TTL_SECONDS: number;
declare const DOC_TTL_SECONDS: number;
declare const SSE_MAX_DURATION_SECONDS = 800;
declare const SSE_RECONNECT_AT_SECONDS = 790;
declare const SSE_PING_INTERVAL_MS = 20000;
type StreamEventEnvelope = {
    event: "message";
    id: string;
    timestamp: number;
    string: string;
};
type StoredDocEnvelope = {
    value: unknown;
    updatedAt: number;
};
declare function normalizePath(path: string | string[]): string;
declare function streamKey(namespace: string, path: string | string[]): string;
declare function docKey(namespace: string, path: string | string[]): string;
declare function fnv1aHash(input: string): string;
declare function objectUpdateStreamPath(objectPath: string | string[]): string;

export { DOC_TTL_SECONDS, SSE_MAX_DURATION_SECONDS, SSE_PING_INTERVAL_MS, SSE_RECONNECT_AT_SECONDS, STREAM_TTL_SECONDS, type StoredDocEnvelope, type StreamEventEnvelope, docKey, fnv1aHash, normalizePath, objectUpdateStreamPath, streamKey };
