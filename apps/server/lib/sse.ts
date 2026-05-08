import {
  SSE_MAX_DURATION_SECONDS,
  SSE_PING_INTERVAL_MS,
  SSE_RECONNECT_AT_SECONDS,
  StreamEventEnvelope,
} from "./keys";
import { getStreamEvents } from "./streams";

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function createStreamSseResponse(
  namespace: string,
  path: string[],
  after: number,
  signal: AbortSignal,
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = after;
      let closed = false;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };

      const sendEvent = (event: string, data: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        }
      };

      const flush = async () => {
        const items: StreamEventEnvelope[] = await getStreamEvents(namespace, path, {
          after: cursor,
          limit: 100,
        });

        for (const item of items) {
          cursor = Math.max(cursor, item.timestamp);
          sendEvent("message", item);
        }
      };

      await flush();

      const pollTimer = setInterval(async () => {
        try {
          await flush();
        } catch {
          // Keep polling; transient failures should not crash SSE.
        }
      }, 1_500);

      const pingTimer = setInterval(() => {
        sendEvent("ping", { ts: Date.now() });
      }, SSE_PING_INTERVAL_MS);

      const reconnectTimer = setTimeout(() => {
        sendEvent("reconnect", { cursor, at: Date.now() });
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        close();
      }, SSE_RECONNECT_AT_SECONDS * 1_000);

      const hardStopTimer = setTimeout(() => {
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        close();
      }, SSE_MAX_DURATION_SECONDS * 1_000);

      const cleanup = () => {
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        clearTimeout(reconnectTimer);
        clearTimeout(hardStopTimer);
        close();
      };
      signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
