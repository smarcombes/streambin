import { createStreamSseResponse } from "@/lib/sse";
import { appendStreamEvent, getStreamEvents } from "@/lib/streams";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

function wantsSse(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const url = new URL(request.url);
  return accept.includes("text/event-stream") || url.searchParams.get("transport") === "sse";
}

export async function POST(request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const body = await request.text();

  const event = await appendStreamEvent(namespace, path, body);
  return Response.json(event, { status: 201 });
}

export async function GET(request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const url = new URL(request.url);
  const after = Number(url.searchParams.get("after") ?? "0") || 0;
  const limit = Number(url.searchParams.get("limit") ?? "100") || 100;

  if (wantsSse(request)) {
    return createStreamSseResponse(namespace, path, after, request.signal);
  }

  const events = await getStreamEvents(namespace, path, { after, limit });
  return Response.json({ events });
}
