"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileDownload, useFileUpload, useStreambinClient } from "@streambin/react-sdk";
import type { StreambinBucket } from "@streambin/react-sdk";
import type { UploadedFile } from "@streambin/sdk";
import { Button } from "./ui/button";

type RawS3Preview = {
  totalSize: number;
  magic: string;
  firstBytesHex: string;
  containsPlaintextSlice: boolean | null;
  contentType: string | null;
};

function toHex(bytes: Uint8Array, limit = 32): string {
  const slice = bytes.subarray(0, Math.min(limit, bytes.byteLength));
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function bytesContains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) {
    return false;
  }
  const last = haystack.byteLength - needle.byteLength;
  outer: for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j < needle.byteLength; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function decodeMagic(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 4);
  let printable = "";
  for (let i = 0; i < head.byteLength; i += 1) {
    const byte = head[i];
    if (byte >= 0x20 && byte <= 0x7e) {
      printable += String.fromCharCode(byte);
    } else {
      printable += ".";
    }
  }
  return printable.padEnd(4, " ");
}

function isTextLike(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType === "application/javascript"
  );
}

function isImageLike(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

function isVideoLike(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith("video/"));
}

function isAudioLike(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith("audio/"));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function FileTester({ bucket, filePath, onFilePathChange }: {
  bucket: StreambinBucket;
  filePath: string;
  onFilePathChange: (next: string) => void;
}) {
  const client = useStreambinClient(bucket);
  const { uploadFile, removeFile, uploading, error: uploadError } = useFileUpload(bucket, filePath);
  const {
    bytes,
    blobUrl,
    contentType,
    encrypted,
    metadata,
    loading: downloading,
    error: downloadError,
    refetch,
  } = useFileDownload(bucket, filePath);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadAsPlaintext, setUploadAsPlaintext] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadedFile | null>(null);
  const [s3Preview, setS3Preview] = useState<RawS3Preview | null>(null);
  const [s3PreviewError, setS3PreviewError] = useState<string | null>(null);
  const [s3InspectInFlight, setS3InspectInFlight] = useState(false);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUploadResult(null);
    setS3Preview(null);
    setS3PreviewError(null);
  }, [filePath]);

  const decodedText = useMemo(() => {
    if (!bytes || !isTextLike(contentType)) return null;
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return null;
    }
  }, [bytes, contentType]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadResult(null);
    setS3Preview(null);
    setS3PreviewError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setS3Preview(null);
    setS3PreviewError(null);
    try {
      const result = await uploadFile(selectedFile, {
        contentType: selectedFile.type || undefined,
        encrypted: !uploadAsPlaintext,
      });
      setUploadResult(result);
      await refetch();
    } catch {
      // surfaced via uploadError
    }
  };

  const inspectS3 = useCallback(async () => {
    const target = uploadResult ?? metadata;
    if (!target) return;
    setS3InspectInFlight(true);
    setS3PreviewError(null);
    try {
      const response = await fetch(target.publicUrl);
      if (!response.ok) {
        throw new Error(`S3 returned ${response.status}`);
      }
      const rawCt = response.headers.get("content-type");
      const buffer = new Uint8Array(await response.arrayBuffer());

      let containsPlaintextSlice: boolean | null = null;
      if (selectedFile && selectedFile.size > 0) {
        const needleBytes = new Uint8Array(
          await selectedFile.slice(0, Math.min(32, selectedFile.size)).arrayBuffer(),
        );
        containsPlaintextSlice = bytesContains(buffer, needleBytes);
      }

      setS3Preview({
        totalSize: buffer.byteLength,
        magic: decodeMagic(buffer),
        firstBytesHex: toHex(buffer, 32),
        containsPlaintextSlice,
        contentType: rawCt,
      });
    } catch (err) {
      setS3PreviewError(err instanceof Error ? err.message : "Failed to fetch S3 body");
    } finally {
      setS3InspectInFlight(false);
    }
  }, [uploadResult, metadata, selectedFile]);

  const handleDelete = async () => {
    if (!metadata && !uploadResult) return;
    setDeleteInFlight(true);
    try {
      await removeFile();
      setUploadResult(null);
      setS3Preview(null);
      setS3PreviewError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSelectedFile(null);
      await refetch();
    } finally {
      setDeleteInFlight(false);
    }
  };

  const current = uploadResult ?? metadata ?? null;
  const fileUrl = filePath ? client.getFileUrl(filePath) : "";

  return (
    <section className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-black/70">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Files (encrypted by default)</h2>
        <span className="text-xs opacity-70">Public URL serves ciphertext for encrypted files</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">File path</span>
          <input
            className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/40"
            value={filePath}
            onChange={(event) => onFilePathChange(event.target.value)}
            placeholder="test/upload.bin"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">Pick a local file</span>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-medium file:text-white dark:file:bg-white dark:file:text-black"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={uploadAsPlaintext}
            onChange={(event) => setUploadAsPlaintext(event.target.checked)}
          />
          Upload as plaintext (skip E2E encryption)
        </label>
        <Button onClick={handleUpload} disabled={!selectedFile || uploading} size="sm">
          {uploading ? "Uploading..." : `Upload${uploadAsPlaintext ? "" : " (encrypted)"}`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refetch();
          }}
          disabled={!filePath || downloading}
        >
          {downloading ? "Loading..." : "Refresh"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          disabled={(!metadata && !uploadResult) || deleteInFlight}
        >
          {deleteInFlight ? "Deleting..." : "Delete"}
        </Button>
      </div>

      {uploadError && (
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300">
          Upload error: {uploadError.message}
        </p>
      )}

      {current && (
        <div className="mt-4 grid gap-3 rounded-md border border-black/10 bg-black/5 p-3 text-xs dark:border-white/10 dark:bg-white/5 md:grid-cols-2">
          <div className="space-y-1">
            <div>
              <span className="font-medium">Encrypted:</span>{" "}
              <span className={current.encrypted ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                {current.encrypted ? "yes (client-side AES-GCM)" : "no (plaintext)"}
              </span>
            </div>
            <div>
              <span className="font-medium">Original type:</span> <code>{current.originalContentType || "—"}</code>
            </div>
            <div>
              <span className="font-medium">Stored type:</span> <code>{current.contentType}</code>
            </div>
            <div>
              <span className="font-medium">Stored size:</span> {formatBytes(current.size)} ({current.size} B)
            </div>
          </div>
          <div className="space-y-1 break-all">
            <div>
              <span className="font-medium">S3 publicUrl:</span>{" "}
              <a className="underline" href={current.publicUrl} target="_blank" rel="noreferrer">
                {current.publicUrl}
              </a>
            </div>
            <div>
              <span className="font-medium">Streambin URL:</span>{" "}
              <a className="underline" href={fileUrl} target="_blank" rel="noreferrer">
                {fileUrl}
              </a>
            </div>
            <div className="pt-1">
              <Button variant="outline" size="sm" onClick={inspectS3} disabled={s3InspectInFlight}>
                {s3InspectInFlight ? "Inspecting..." : "Inspect raw S3 body"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {s3Preview && (
        <div className="mt-3 rounded-md border border-black/10 bg-white/70 p-3 text-xs dark:border-white/10 dark:bg-black/40">
          <div className="mb-2 flex items-center justify-between">
            <strong>Raw bytes on S3 (proof of ciphertext)</strong>
            <span className="opacity-60">{formatBytes(s3Preview.totalSize)} total</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <div>
                <span className="font-medium">Magic (first 4 bytes):</span>{" "}
                <code className="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">{s3Preview.magic}</code>{" "}
                {(s3Preview.magic === "SBF1" || s3Preview.magic === "SBF2") && (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    ✓ encrypted envelope
                  </span>
                )}
              </div>
              <div className="mt-1">
                <span className="font-medium">S3 Content-Type:</span> <code>{s3Preview.contentType ?? "—"}</code>
              </div>
              {s3Preview.containsPlaintextSlice !== null && (
                <div className="mt-1">
                  <span className="font-medium">Contains plaintext prefix of source file:</span>{" "}
                  {s3Preview.containsPlaintextSlice ? (
                    <span className="text-amber-700 dark:text-amber-400">yes (plaintext upload)</span>
                  ) : (
                    <span className="text-emerald-700 dark:text-emerald-400">no — zero leakage</span>
                  )}
                </div>
              )}
            </div>
            <pre className="overflow-auto rounded bg-black/80 p-2 font-mono text-[11px] leading-5 text-emerald-200">
              {s3Preview.firstBytesHex}
            </pre>
          </div>
        </div>
      )}

      {s3PreviewError && (
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300">
          S3 inspect error: {s3PreviewError}
        </p>
      )}

      <div className="mt-4 rounded-md border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/5">
        <div className="mb-2 flex items-center justify-between">
          <strong className="text-sm">Decrypted preview (via SDK)</strong>
          {bytes && (
            <span className="text-xs opacity-70">{formatBytes(bytes.byteLength)} · {contentType ?? "—"}</span>
          )}
        </div>
        {downloading && <p className="text-xs opacity-70">Decrypting...</p>}
        {!downloading && downloadError && (
          <p className="text-xs text-rose-600 dark:text-rose-300">{downloadError.message}</p>
        )}
        {!downloading && !downloadError && !bytes && (
          <p className="text-xs opacity-70">
            Nothing at <code>{filePath}</code> yet. Upload above.
          </p>
        )}
        {!downloading && bytes && isImageLike(contentType) && blobUrl && (
          <img src={blobUrl} alt={filePath} className="max-h-80 max-w-full rounded-md border border-black/10 dark:border-white/10" />
        )}
        {!downloading && bytes && isVideoLike(contentType) && blobUrl && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={blobUrl} controls className="max-h-80 max-w-full rounded-md border border-black/10 dark:border-white/10" />
        )}
        {!downloading && bytes && isAudioLike(contentType) && blobUrl && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={blobUrl} controls className="w-full" />
        )}
        {!downloading && bytes && isTextLike(contentType) && decodedText !== null && (
          <pre className="max-h-72 overflow-auto rounded bg-black/80 p-3 font-mono text-xs text-emerald-100">
            {decodedText}
          </pre>
        )}
        {!downloading && bytes && !isImageLike(contentType) && !isVideoLike(contentType) && !isAudioLike(contentType) && !isTextLike(contentType) && blobUrl && (
          <a className="text-xs underline" href={blobUrl} download={filePath.split("/").pop() ?? "download"}>
            Download decrypted file ({formatBytes(bytes.byteLength)})
          </a>
        )}
        {encrypted !== null && bytes && (
          <p className="mt-2 text-[11px] opacity-70">
            {encrypted
              ? "Bytes above were decrypted client-side after fetching ciphertext from S3."
              : "Bytes above were fetched as plaintext directly from S3."}
          </p>
        )}
      </div>
    </section>
  );
}
