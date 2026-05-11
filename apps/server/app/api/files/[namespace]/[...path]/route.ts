import {
  completeMultipartUpload,
  completeSingleUpload,
  deleteFile,
  getFileMetadata,
  prepareFileUpload,
} from "@/lib/files";
import { normalizePath } from "@/lib/keys";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

type PrepareRequestBody = {
  action?: "prepare";
  filename?: string;
  contentType?: string;
  originalContentType?: string;
  encrypted?: boolean;
  size?: number;
  multipart?: {
    enabled?: boolean;
    partSize?: number;
  };
};

type CompleteSingleBody = {
  action: "completeSingle";
  fileId: string;
  key: string;
  contentType?: string;
  originalContentType?: string;
  encrypted?: boolean;
  size?: number;
};

type CompleteMultipartBody = {
  action: "completeMultipart";
  fileId: string;
  key: string;
  uploadId: string;
  contentType?: string;
  originalContentType?: string;
  encrypted?: boolean;
  size?: number;
  parts?: Array<{ partNumber: number; eTag: string }>;
};

type RequestBody = PrepareRequestBody | CompleteSingleBody | CompleteMultipartBody;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const body = (await request.json()) as RequestBody;
  const action = body.action ?? "prepare";

  if (action === "prepare") {
    const prepareBody = body as PrepareRequestBody;
    const size = Number(body.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) {
      return Response.json({ error: "size must be a positive number" }, { status: 400, headers: corsHeaders });
    }

    const prepared = await prepareFileUpload({
      namespace,
      path,
      contentType: prepareBody.contentType,
      originalContentType: prepareBody.originalContentType,
      encrypted: prepareBody.encrypted,
      size,
      multipart: prepareBody.multipart,
    });
    return Response.json(prepared, { status: 201, headers: corsHeaders });
  }

  if (action === "completeSingle") {
    const completeBody = body as CompleteSingleBody;
    if (!completeBody.fileId || !completeBody.key || !completeBody.size) {
      return Response.json(
        { error: "fileId, key, and size are required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const metadata = await completeSingleUpload({
      namespace,
      path,
      fileId: completeBody.fileId,
      key: completeBody.key,
      contentType: completeBody.contentType ?? "application/octet-stream",
      originalContentType: completeBody.originalContentType,
      encrypted: completeBody.encrypted,
      size: completeBody.size,
    });
    return Response.json(metadata, { headers: corsHeaders });
  }

  if (action === "completeMultipart") {
    const completeBody = body as CompleteMultipartBody;
    if (!completeBody.fileId || !completeBody.key || !completeBody.uploadId || !completeBody.size || !completeBody.parts?.length) {
      return Response.json(
        { error: "fileId, key, uploadId, size, and parts are required" },
        { status: 400, headers: corsHeaders },
      );
    }

    const metadata = await completeMultipartUpload({
      namespace,
      path,
      fileId: completeBody.fileId,
      key: completeBody.key,
      uploadId: completeBody.uploadId,
      contentType: completeBody.contentType ?? "application/octet-stream",
      originalContentType: completeBody.originalContentType,
      encrypted: completeBody.encrypted,
      size: completeBody.size,
      parts: completeBody.parts,
    });
    return Response.json(metadata, { headers: corsHeaders });
  }

  return Response.json({ error: "unsupported action" }, { status: 400, headers: corsHeaders });
}

export async function GET(request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  const metadata = await getFileMetadata(namespace, normalizePath(path));
  if (!metadata) {
    return Response.json({ url: null }, { status: 404, headers: corsHeaders });
  }

  const url = new URL(request.url);
  if (url.searchParams.has("meta")) {
    return Response.json(
      {
        fileId: metadata.fileId,
        key: metadata.key,
        publicUrl: metadata.publicUrl,
        contentType: metadata.contentType,
        originalContentType: metadata.originalContentType,
        encrypted: metadata.encrypted,
        size: metadata.size,
        updatedAt: metadata.updatedAt,
      },
      { headers: corsHeaders },
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: metadata.publicUrl,
    },
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ namespace: string; path: string[] }> }) {
  const { namespace, path } = await context.params;
  await deleteFile(namespace, path);
  return new Response(null, { status: 204, headers: corsHeaders });
}
