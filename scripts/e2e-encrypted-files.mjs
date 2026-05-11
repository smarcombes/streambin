#!/usr/bin/env node
// Ad-hoc end-to-end test for client-side encrypted public files.
// Not committed to CI; run manually against a live server.
import { randomUUID } from "node:crypto";
import { readEncryptedFileFormat } from "../packages/crypto/dist/index.js";
import { StreambinClient } from "../packages/sdk/dist/index.js";

const BASE_URL = process.env.STREAMBIN_BASE_URL ?? "http://localhost:3001";
const NAMESPACE = process.env.STREAMBIN_NS ?? `e2e-${randomUUID().slice(0, 8)}`;
const PASSPHRASE = process.env.STREAMBIN_PASSPHRASE ?? "e2e-passphrase-do-not-reuse";
const CHUNK_SIZE = 5 * 1024 * 1024;
const PLAINTEXT_TOKEN = `e2e-plaintext-canary-${randomUUID()}`;

function makePlaintext(size, seed = 7) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * seed + 3) & 0xff;
  }
  // Embed our canary token at the start so we can grep for it.
  const tokenBytes = new TextEncoder().encode(PLAINTEXT_TOKEN);
  bytes.set(tokenBytes.subarray(0, Math.min(tokenBytes.length, bytes.length)), 0);
  return bytes;
}

function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bytesContains(haystack, needle) {
  if (needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

const client = new StreambinClient({
  baseUrl: BASE_URL,
  namespace: NAMESPACE,
  passphrase: PASSPHRASE,
});

let failures = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ok    - ${name}`);
  } else {
    console.log(`  FAIL  - ${name}${detail ? ` (${detail})` : ""}`);
    failures += 1;
  }
}

async function fetchCiphertext(publicUrl) {
  const res = await fetch(publicUrl);
  if (!res.ok) {
    throw new Error(`Failed to GET ${publicUrl}: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function run() {
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Namespace: ${NAMESPACE}`);

  const tokenBytes = new TextEncoder().encode(PLAINTEXT_TOKEN);

  // ---- SBF1: small file ----
  console.log("\n[SBF1] small file");
  const smallPath = `e2e/small-${randomUUID().slice(0, 6)}.bin`;
  const smallPlaintext = makePlaintext(1024);
  const smallUpload = await client.uploadFile(smallPath, smallPlaintext, {
    contentType: "application/octet-stream",
  });
  assert("upload marked encrypted", smallUpload.encrypted === true);
  assert("upload reports originalContentType", smallUpload.originalContentType === "application/octet-stream");

  const smallCiphertext = await fetchCiphertext(smallUpload.publicUrl);
  assert("S3 body starts with SBF1 magic", readEncryptedFileFormat(smallCiphertext) === "SBF1");
  assert(
    "S3 body does NOT contain plaintext canary token",
    !bytesContains(smallCiphertext, tokenBytes),
  );

  const smallDownload = await client.downloadFile(smallPath);
  assert("downloadFile returns non-null", smallDownload !== null);
  assert("downloadFile reports encrypted=true", smallDownload?.encrypted === true);
  assert(
    "decrypted bytes equal plaintext",
    smallDownload ? bytesEqual(smallDownload.bytes, smallPlaintext) : false,
  );

  await client.deleteFile(smallPath);

  // ---- SBF2: file larger than chunkSize -> multipart ----
  console.log("\n[SBF2] multipart file (> chunkSize)");
  const largePath = `e2e/large-${randomUUID().slice(0, 6)}.bin`;
  const largePlaintext = makePlaintext(CHUNK_SIZE * 2 + 1234, 11);
  const largeUpload = await client.uploadFile(largePath, largePlaintext, {
    chunkSize: CHUNK_SIZE,
    multipart: { enabled: true },
  });
  assert("upload marked encrypted", largeUpload.encrypted === true);

  const largeCiphertext = await fetchCiphertext(largeUpload.publicUrl);
  assert("S3 body starts with SBF2 magic", readEncryptedFileFormat(largeCiphertext) === "SBF2");
  assert(
    "S3 body does NOT contain plaintext canary token",
    !bytesContains(largeCiphertext, tokenBytes),
  );

  const largeDownload = await client.downloadFile(largePath);
  assert("downloadFile (SBF2) returns non-null", largeDownload !== null);
  assert(
    "decrypted SBF2 bytes equal plaintext",
    largeDownload ? bytesEqual(largeDownload.bytes, largePlaintext) : false,
  );

  // downloadFileStream round-trip
  const streamed = await client.downloadFileStream(largePath);
  assert("downloadFileStream returns non-null", streamed !== null);
  if (streamed) {
    const reader = streamed.stream.getReader();
    const pieces = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pieces.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of pieces) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    assert("streamed plaintext equals original", bytesEqual(out, largePlaintext));
  }

  await client.deleteFile(largePath);

  // ---- Plaintext opt-out ----
  console.log("\n[plaintext] encrypted=false opt-out");
  const plainPath = `e2e/plain-${randomUUID().slice(0, 6)}.txt`;
  const plainBytes = new TextEncoder().encode("hello plaintext world");
  const plainUpload = await client.uploadFile(plainPath, plainBytes, {
    encrypted: false,
    contentType: "text/plain",
  });
  assert("upload reports encrypted=false", plainUpload.encrypted === false);

  const plainCiphertext = await fetchCiphertext(plainUpload.publicUrl);
  assert("S3 body equals plaintext", bytesEqual(plainCiphertext, plainBytes));

  const plainDownload = await client.downloadFile(plainPath);
  assert("downloadFile returns plaintext bytes", plainDownload ? bytesEqual(plainDownload.bytes, plainBytes) : false);
  assert("downloadFile reports encrypted=false", plainDownload?.encrypted === false);

  await client.deleteFile(plainPath);

  console.log("\n=================");
  if (failures > 0) {
    console.log(`FAILED: ${failures} assertions`);
    process.exit(1);
  } else {
    console.log("ALL OK");
  }
}

run().catch((err) => {
  console.error("E2E script crashed:", err);
  process.exit(2);
});
