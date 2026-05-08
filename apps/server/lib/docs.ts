import {
  DOC_TTL_SECONDS,
  StoredDocEnvelope,
  docKey,
  objectUpdateStreamPath,
  normalizePath,
} from "./keys";
import { getRedis } from "./redis";
import { appendStreamEvent } from "./streams";

export async function setDoc(
  namespace: string,
  path: string | string[],
  value: unknown,
): Promise<StoredDocEnvelope> {
  const key = docKey(namespace, path);
  const doc: StoredDocEnvelope = {
    value,
    updatedAt: Date.now(),
  };

  const redis = getRedis();
  await redis.set(key, doc, { ex: DOC_TTL_SECONDS });

  const updatePath = objectUpdateStreamPath(normalizePath(path));
  await appendStreamEvent(namespace, updatePath, JSON.stringify(value));

  return doc;
}

export async function getDoc(
  namespace: string,
  path: string | string[],
): Promise<StoredDocEnvelope | null> {
  const redis = getRedis();
  const key = docKey(namespace, path);
  const doc = await redis.get<StoredDocEnvelope>(key);
  return doc ?? null;
}

export async function deleteDoc(namespace: string, path: string | string[]): Promise<void> {
  const redis = getRedis();
  const key = docKey(namespace, path);
  await redis.del(key);
}
