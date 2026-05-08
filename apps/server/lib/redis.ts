import { Redis } from "@upstash/redis";

let instance: Redis | null = null;

export function getRedis(): Redis {
  if (!instance) {
    instance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  return instance;
}
