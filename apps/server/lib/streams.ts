import { randomUUID } from "node:crypto";
import {
  STREAM_TTL_SECONDS,
  StreamEventEnvelope,
  normalizePath,
  streamKey,
} from "./keys";
import { getRedis } from "./redis";

const MAX_SCAN_ITEMS = 2000;

export async function appendStreamEvent(
  namespace: string,
  path: string | string[],
  payload: string,
): Promise<StreamEventEnvelope> {
  const key = streamKey(namespace, path);
  const event: StreamEventEnvelope = {
    event: "message",
    id: randomUUID(),
    timestamp: Date.now(),
    string: payload,
  };

  const redis = getRedis();
  await redis.rpush(key, JSON.stringify(event));
  await redis.expire(key, STREAM_TTL_SECONDS);

  return event;
}

export async function getStreamEvents(
  namespace: string,
  path: string | string[],
  options?: { after?: number; limit?: number },
): Promise<StreamEventEnvelope[]> {
  const key = streamKey(namespace, normalizePath(path));
  const after = options?.after ?? 0;
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 100));

  const redis = getRedis();
  // Upstash REST lrange behavior is more reliable with explicit 0..-1 range.
  // We cap the scanned window in-memory to avoid unbounded parsing.
  const rawItems = ((await redis.lrange<unknown>(key, 0, -1)) ?? []).slice(-MAX_SCAN_ITEMS);

  const parsed: StreamEventEnvelope[] = [];
  for (const raw of rawItems) {
    try {
      const event =
        typeof raw === "string"
          ? (JSON.parse(raw) as StreamEventEnvelope)
          : (raw as StreamEventEnvelope);
      if (event.timestamp > after) {
        parsed.push(event);
      }
    } catch {
      // Ignore malformed records.
    }
  }

  return parsed.slice(-limit);
}
