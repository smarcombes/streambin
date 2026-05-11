# @streambin/sdk

TypeScript SDK for [Streambin](https://streambin.xyz) — end-to-end encrypted streams and documents, plus simple public file uploads (3-day retention).

```bash
npm install @streambin/sdk
```

## Quick start

```ts
import { StreambinClient } from "@streambin/sdk";

const client = new StreambinClient({
  baseUrl: "https://streambin.xyz",
  namespace: "frozen-castor",
  passphrase: "my-secret-passphrase",
});
```

All payloads stored via `appendMessage`, `appendJson`, `setObject`, and `updateObject` are encrypted client-side using PBKDF2 + AES-GCM. The server only sees opaque ciphertext.

File uploads (described below) are **public by design** — they are stored unencrypted in the bucket's S3 backend so that any holder of the URL can fetch them.

## Streams

```ts
await client.appendMessage("agents/run-log", "deployment started");
await client.appendJson("agents/events", { type: "deploy", id: 7 });

const events = await client.getStream("agents/run-log", {
  after: Date.now() - 60_000,
  limit: 20,
});

const stop = client.listenStream("agents/run-log", (value) => {
  console.log("stream value:", value);
});
```

## Documents

```ts
await client.setObject("agents/status", { step: "running" });
await client.updateObject("agents/status", {
  "progress.percent": 75,
  "progress.message": "Processing...",
});

const status = await client.getObject("agents/status");
const stopWatching = client.listenObject("agents/status", (next) => {
  console.log("doc changed:", next);
});

await client.removeObject("agents/status");
```

## Files

Upload public files keyed by `sha256(namespace + "/" + path)`. Files auto-expire after **3 days** via the bucket's lifecycle rule — there is no cron, the storage backend handles deletion.

```ts
// Upload from a Blob (browser) or Buffer/Uint8Array (Node.js)
const result = await client.uploadFile("assets/logo.png", file);
console.log(result.publicUrl);
// e.g. https://streambin.s3.amazonaws.com/files/<sha256-hash>

// Stable URL that redirects to the current public URL
const stableUrl = client.getFileUrl("assets/logo.png");
// https://streambin.xyz/api/files/<namespace>/assets/logo.png

// Delete the file (metadata + S3 object)
await client.deleteFile("assets/logo.png");
```

### Large files (multipart)

`uploadFile` automatically switches to S3 multipart upload above ~8 MB. You can force a strategy:

```ts
await client.uploadFile("archives/dump.bin", largeBuffer, {
  contentType: "application/octet-stream",
  multipart: { enabled: true, partSize: 8 * 1024 * 1024 },
});
```

### File API surface

```ts
type UploadableFile = Blob | ArrayBuffer | Uint8Array;

type UploadFileOptions = {
  contentType?: string;
  multipart?: { enabled?: boolean; partSize?: number };
};

type UploadedFile = {
  fileId: string;       // sha256(namespace + "/" + path)
  key: string;          // S3 object key (files/<fileId>)
  publicUrl: string;    // direct S3 URL
  contentType: string;
  size: number;
  updatedAt: number;
};

client.uploadFile(path: string, file: UploadableFile, options?: UploadFileOptions): Promise<UploadedFile>;
client.getFileUrl(path: string): string;
client.deleteFile(path: string): Promise<void>;
```

## Browser (ESM CDN)

```html
<script type="module">
  import { StreambinClient } from "https://esm.sh/@streambin/sdk";

  const client = new StreambinClient({
    baseUrl: "https://streambin.xyz",
    namespace: "frozen-castor",
    passphrase: "my-secret-passphrase",
  });

  document.querySelector("input[type=file]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const result = await client.uploadFile(`uploads/${file.name}`, file);
    console.log(result.publicUrl);
  });
</script>
```

## Retention

- **Streams + documents**: 3-day TTL in Redis
- **Files**: 3-day expiration via S3 lifecycle rule on the `files/` prefix

Uploading to the same `(namespace, path)` overwrites the existing file (same deterministic key).

## License

MIT
