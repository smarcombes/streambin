import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getRedis } from "./redis";
import {
  FILE_TTL_SECONDS,
  StoredFileEnvelope,
  fileIdFromNamespacePath,
  fileLookupKey,
  normalizePath,
} from "./keys";

const DEFAULT_PRESIGN_EXPIRY_SECONDS = 15 * 60;
const DEFAULT_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;

export type PrepareFileUploadInput = {
  namespace: string;
  path: string | string[];
  contentType?: string;
  originalContentType?: string;
  encrypted?: boolean;
  size: number;
  multipart?: {
    enabled?: boolean;
    partSize?: number;
  };
};

export type PreparedSingleUpload = {
  mode: "single";
  fileId: string;
  key: string;
  method: "PUT";
  url: string;
  contentType: string;
  expiresIn: number;
  publicUrl: string;
};

export type PreparedMultipartUpload = {
  mode: "multipart";
  fileId: string;
  key: string;
  uploadId: string;
  contentType: string;
  partSize: number;
  parts: Array<{ partNumber: number; url: string }>;
  expiresIn: number;
  publicUrl: string;
};

export type PreparedFileUpload = PreparedSingleUpload | PreparedMultipartUpload;

export type CompleteSingleUploadInput = {
  namespace: string;
  path: string | string[];
  fileId: string;
  key: string;
  contentType: string;
  originalContentType?: string;
  encrypted?: boolean;
  size: number;
};

export type CompleteMultipartUploadInput = CompleteSingleUploadInput & {
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
};

let s3Client: S3Client | null = null;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getBucketName(): string {
  return getEnv("S3_BUCKET_NAME");
}

function getRegion(): string {
  return getEnv("AWS_REGION");
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: getRegion(),
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  return s3Client;
}

function normalizeContentType(contentType?: string): string {
  return contentType?.trim() || "application/octet-stream";
}

function toS3ObjectKey(namespace: string, path: string | string[]): { fileId: string; key: string } {
  const fileId = fileIdFromNamespacePath(namespace, path);
  return { fileId, key: `files/${fileId}` };
}

function assertCanonicalFileIdentity(
  namespace: string,
  path: string | string[],
  fileId: string,
  key: string,
): void {
  const canonical = toS3ObjectKey(namespace, path);
  if (canonical.fileId !== fileId || canonical.key !== key) {
    throw new Error("fileId/key does not match namespace+path");
  }
}

function normalizePartSize(partSize?: number): number {
  if (!partSize || Number.isNaN(partSize)) {
    return DEFAULT_MULTIPART_PART_SIZE_BYTES;
  }
  return Math.max(5 * 1024 * 1024, Math.floor(partSize));
}

function shouldUseMultipart(size: number, multipart?: PrepareFileUploadInput["multipart"]): boolean {
  if (multipart?.enabled === false) {
    return false;
  }
  if (multipart?.enabled === true) {
    return true;
  }
  return size >= DEFAULT_MULTIPART_THRESHOLD_BYTES;
}

function getPublicBaseUrl(): string {
  if (process.env.S3_PUBLIC_BASE_URL) {
    return process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const bucket = getBucketName();
  const region = getRegion();
  if (region === "us-east-1") {
    return `https://${bucket}.s3.amazonaws.com`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toPublicUrl(key: string): string {
  return `${getPublicBaseUrl()}/${encodeObjectKey(key)}`;
}

export async function prepareFileUpload(input: PrepareFileUploadInput): Promise<PreparedFileUpload> {
  const normalizedPath = normalizePath(input.path);
  const encrypted = input.encrypted === true;
  const contentType = encrypted
    ? "application/octet-stream"
    : normalizeContentType(input.contentType);
  const { fileId, key } = toS3ObjectKey(input.namespace, normalizedPath);
  const publicUrl = toPublicUrl(key);
  const expiresIn = DEFAULT_PRESIGN_EXPIRY_SECONDS;
  const bucket = getBucketName();
  const client = getS3Client();

  if (!shouldUseMultipart(input.size, input.multipart)) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(client, command, { expiresIn });
    return {
      mode: "single",
      fileId,
      key,
      method: "PUT",
      url,
      contentType,
      expiresIn,
      publicUrl,
    };
  }

  const createCommand = new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  const created = await client.send(createCommand);
  if (!created.UploadId) {
    throw new Error("Failed to create multipart upload");
  }

  const uploadId = created.UploadId;
  const partSize = normalizePartSize(input.multipart?.partSize);
  const partCount = Math.ceil(input.size / partSize);

  if (partCount < 1 || partCount > MAX_MULTIPART_PARTS) {
    throw new Error(`Unsupported multipart part count (${partCount})`);
  }

  const parts: Array<{ partNumber: number; url: string }> = [];
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const partCommand = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    const url = await getSignedUrl(client, partCommand, { expiresIn });
    parts.push({ partNumber, url });
  }

  return {
    mode: "multipart",
    fileId,
    key,
    uploadId,
    contentType,
    partSize,
    parts,
    expiresIn,
    publicUrl,
  };
}

export async function completeSingleUpload(input: CompleteSingleUploadInput): Promise<StoredFileEnvelope> {
  assertCanonicalFileIdentity(input.namespace, input.path, input.fileId, input.key);
  const encrypted = input.encrypted === true;
  const storedContentType = encrypted
    ? "application/octet-stream"
    : normalizeContentType(input.contentType);
  const originalContentType = normalizeContentType(
    input.originalContentType ?? input.contentType,
  );
  const metadata: StoredFileEnvelope = {
    fileId: input.fileId,
    key: input.key,
    publicUrl: toPublicUrl(input.key),
    contentType: storedContentType,
    originalContentType,
    encrypted,
    size: input.size,
    updatedAt: Date.now(),
  };

  const redis = getRedis();
  await redis.set(fileLookupKey(input.namespace, input.path), metadata, { ex: FILE_TTL_SECONDS });
  return metadata;
}

export async function completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<StoredFileEnvelope> {
  const client = getS3Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: getBucketName(),
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: input.parts.map((part) => ({
          ETag: part.eTag,
          PartNumber: part.partNumber,
        })),
      },
    }),
  );

  return completeSingleUpload(input);
}

export async function getFileMetadata(
  namespace: string,
  path: string | string[],
): Promise<StoredFileEnvelope | null> {
  const redis = getRedis();
  const metadata = await redis.get<StoredFileEnvelope>(fileLookupKey(namespace, path));
  return metadata ?? null;
}

export async function deleteFile(namespace: string, path: string | string[]): Promise<void> {
  const redis = getRedis();
  const lookup = fileLookupKey(namespace, path);
  const metadata = await redis.get<StoredFileEnvelope>(lookup);
  if (metadata) {
    const client = getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: getBucketName(),
        Key: metadata.key,
      }),
    );
  }
  await redis.del(lookup);
}
