import { deleteDoc, getDoc, setDoc } from "@/lib/docs";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const body = await request.json();
  const saved = await setDoc(namespace, path, body);
  return Response.json(saved, { status: 201, headers: corsHeaders });
}

export async function GET(_request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const doc = await getDoc(namespace, path);

  if (!doc) {
    return Response.json({ value: null }, { status: 404, headers: corsHeaders });
  }

  return Response.json(doc, { headers: corsHeaders });
}

export async function DELETE(_request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  await deleteDoc(namespace, path);
  return new Response(null, { status: 204, headers: corsHeaders });
}
