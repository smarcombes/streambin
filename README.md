# Streambin

**End-to-end encrypted streams and documents for agents and humans.**

Live demo: [https://streambin.xyz/demo](https://streambin.xyz/demo)

Streambin is a public relay for short-lived data, plus SDKs that make it private by default.

Mental model:

1. **Public server (Next.js on `streambin.xyz` — feel free to self-host)**
  - Anyone can read/write **public streams**
  - Anyone can read/write **public JSON documents**
  - All stored data expires automatically after 3 days
2. **Client tools (`@streambin/sdk` + `@streambin/react-sdk`)**
  - Encrypt data client-side before sending to `streambin.xyz`
  - Decrypt data client-side after reading from `streambin.xyz`
  - Use the public server as a transport layer to exchange encrypted data with anyone who has the same passphrase and can reach `streambin.xyz`

In practice, the server handles storage and delivery, while privacy is enforced at the client layer.

🔐 **Zero-knowledge architecture** — Server never sees plaintext (unless you deliberately send it non-encrypted payloads)  
🕒 **Privacy-first retention** — Payloads automatically expire after 3 days  
⚡ **Real-time SSE streams** — Resilient reconnection with automatic recovery  
🔄 **Firebase-style reactive docs** — Set/update/listen to objects with dot-path merges  
🤖 **Agent-first CLI** — Local bucket management for AI workflows  
🌐 **Cross-platform** — TypeScript, React, Python, CURL, and HTTP APIs

---

## Features

### Streams

- **Append-only message streams** with configurable namespaces (typically encrypted via SDK/CLI)
- **Server-Sent Events (SSE)** for real-time listening with automatic reconnection
- **Cursor-based pagination** for historical message retrieval
- **Automatic expiration** after 3 days

### Documents

- **Key-value documents** with Firebase-style reactivity (typically encrypted via SDK/CLI)
- **Dot-path updates** for partial object merges (e.g., `{ "user.profile.photo.url": "..." }`)
- **Real-time listeners** that react to changes across clients
- **Automatic expiration** after 3 days

### Files

- **Public file uploads** with deterministic names (`sha256(namespace + "/" + path)`)
- **Simple upload API** with optional S3 multipart support for large files
- **Stable read URLs** through `/api/files/:namespace/[...path]`
- **Automatic expiration** after 3 days via S3 lifecycle rules

### Security

- **Client-side encryption** using Web Crypto API (PBKDF2 + AES-GCM)
- **Passphrase-derived keys** with salt and authenticated encryption
- **Zero-knowledge server** stores opaque encrypted envelopes (or plaintext if you send plaintext)
- **Privacy-first retention** with automatic 3-day payload expiration
- **Versioned ciphertext envelope** for future crypto upgrades

---

## Quick Start

### Installation

```bash
# TypeScript/Node.js SDK
npm install @streambin/sdk

# React SDK (requires React 19+)
npm install @streambin/react-sdk

# Agent CLI
npx streambin.xyz
```

### TypeScript SDK

```typescript
import { StreambinClient } from "@streambin/sdk";

// Create a bucket config
const bucket = {
  baseUrl: "https://streambin.xyz",
  namespace: "frozen-castor",
  passphrase: "my-secret-passphrase",
};

const client = new StreambinClient(bucket);

// Post to a stream
await client.appendMessage("agents/run-log", "hello from sdk");

// Listen to a stream (real-time SSE)
const stop = client.listenStream("agents/run-log", (message) => {
  console.log("Received:", message);
});

// Get last messages (with cursor pagination)
const events = await client.getStream("agents/run-log", {
  after: Date.now() - 3600000, // last hour
  limit: 10,
});

// Save a doc
await client.setObject("agents/status", { step: "running" });

// Watch doc for changes
const stopWatching = client.listenObject("agents/status", (value) => {
  console.log("Doc changed:", value);
});

// Update doc (Firebase-style merge)
await client.updateObject("agents/status", {
  "progress.percent": 75,
  "progress.message": "Processing...",
});

// Delete a doc
await client.removeObject("agents/status");

// Upload a public file (auto-expires after 3 days)
const uploaded = await client.uploadFile("assets/logo.png", fileOrBuffer);
console.log(uploaded.publicUrl);

// Resolve the stable Streambin URL (redirects to the public S3 URL)
const stableUrl = client.getFileUrl("assets/logo.png");

// Remove the file (metadata + S3 object)
await client.deleteFile("assets/logo.png");
```

### Browser (ESM CDN)

```html
<!DOCTYPE html>
<html>
<head>
  <title>Streambin Browser Example</title>
</head>
<body>
  <h1>Streambin in Browser</h1>
  <div id="messages"></div>
  <button id="send">Send Message</button>
  
  <script type="module">
    import { StreambinClient } from "https://esm.sh/@streambin/sdk@0.1.2";
    
    const client = new StreambinClient({
      baseUrl: "https://streambin.xyz",
      namespace: "frozen-castor",
      passphrase: "my-secret-passphrase",
    });
    
    // Listen to stream
    client.listenStream("agents/run-log", (message) => {
      const div = document.createElement("div");
      div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      document.getElementById("messages").appendChild(div);
    });
    
    // Send on button click
    document.getElementById("send").addEventListener("click", async () => {
      await client.appendMessage("agents/run-log", `Hello at ${Date.now()}`);
    });
  </script>
</body>
</html>
```

### React Hooks

```typescript
import {
  useStream,
  useSendToStream,
  useObject,
  useObjectActions,
  useFileUpload,
} from "@streambin/react-sdk";

function MyComponent() {
  const bucket = {
    baseUrl: "https://streambin.xyz",
    namespace: "frozen-castor",
    passphrase: "my-secret-passphrase",
  };

  // Send messages to a stream
  const { sendMessage } = useSendToStream(bucket, "agents/run-log");
  const onSend = () => {
    void sendMessage("hello from react");
  };

  // Listen to a stream
  const { messages, connected } = useStream(bucket, "agents/run-log");

  // Watch an object
  const { value: doc, loading } = useObject(bucket, "agents/status");

  // Update an object
  const { set, update, remove } = useObjectActions(bucket, "agents/status");
  const onMarkDone = () => {
    void update((current) => ({
      ...(current ?? {}),
      step: "completed",
    }));
  };

  // Upload a public file
  const { uploadFile, getFileUrl, uploading } =
    useFileUpload(bucket, "assets/logo.png");
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };

  return (
    <div>
      <button onClick={onSend}>Send</button>
      <button onClick={onMarkDone}>Mark done</button>
      <div>{connected ? "Live" : "Reconnecting..."}</div>
      <div>{loading ? "Loading doc..." : JSON.stringify(doc)}</div>
      <div>Messages: {messages.length}</div>
    </div>
  );
}
```

### CLI

```bash
# Create a bucket (generates random namespace + passphrase)
npx streambin.xyz create frozen-castor

# Or specify explicitly
npx streambin.xyz create frozen-castor --namespace my-ns --passphrase secret

# List local buckets
npx streambin.xyz list

# Switch to a bucket
npx streambin.xyz use frozen-castor

# Export bucket config for another machine
npx streambin.xyz export frozen-castor

# Send a message to a stream
npx streambin.xyz send agents/run-log "deployment started"

# Tail a stream (real-time)
npx streambin.xyz tail agents/run-log

# Get last messages
npx streambin.xyz get agents/run-log --after 1715000000000 --limit 10

# Set a doc
npx streambin.xyz set-object agents/status '{"step":"running"}'

# Listen for doc changes
npx streambin.xyz listen-object agents/status

# Update a doc (merge)
npx streambin.xyz update-object agents/status '{"progress.percent":75}'

# Delete a doc
npx streambin.xyz remove-object agents/status

# Upload a public file (auto-expires after 3 days)
npx streambin.xyz upload-file assets/logo.png ./logo.png

# Print the stable Streambin URL for the file
npx streambin.xyz file-url assets/logo.png

# Download the file
npx streambin.xyz download-file assets/logo.png ./logo.png

# Remove the file
npx streambin.xyz remove-file assets/logo.png
```

### CURL (relay API)

```bash
BASE_URL="https://streambin.xyz"

# Post to a stream (plaintext relay)
curl -sS -X POST \
  "$BASE_URL/api/streams/frozen-castor/agents/run-log" \
  -H "Content-Type: text/plain" \
  --data-binary "Hello from curl"

# Listen to a stream (SSE)
curl -N -sS "$BASE_URL/api/streams/frozen-castor/agents/run-log?transport=sse" \
  | sed -n 's/^data: //p'

# Get last messages
curl -sS "$BASE_URL/api/streams/frozen-castor/agents/run-log?after=1715000000000&limit=10" \
  | jq .

# Save a doc (JSON relay)
curl -sS -X POST \
  "$BASE_URL/api/docs/frozen-castor/agents/status" \
  -H "Content-Type: application/json" \
  -d '{"step":"running"}'

# Get a doc
curl -sS "$BASE_URL/api/docs/frozen-castor/agents/status" | jq .

# Delete a doc
curl -sS -X DELETE "$BASE_URL/api/docs/frozen-castor/agents/status"

# Upload a public file (two-step: prepare + PUT + completeSingle)
PREPARED=$(curl -sS -X POST \
  "$BASE_URL/api/files/frozen-castor/assets/logo.png" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"prepare\",\"size\":$(stat -f%z ./logo.png),\"contentType\":\"image/png\"}")

UPLOAD_URL=$(echo "$PREPARED" | jq -r .url)
FILE_ID=$(echo "$PREPARED" | jq -r .fileId)
KEY=$(echo "$PREPARED" | jq -r .key)

curl -sS -X PUT "$UPLOAD_URL" -H "Content-Type: image/png" --data-binary @./logo.png

curl -sS -X POST \
  "$BASE_URL/api/files/frozen-castor/assets/logo.png" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"completeSingle\",\"fileId\":\"$FILE_ID\",\"key\":\"$KEY\",\"contentType\":\"image/png\",\"size\":$(stat -f%z ./logo.png)}"

# Read the file (302 redirect to its public S3 URL)
curl -sSL "$BASE_URL/api/files/frozen-castor/assets/logo.png" -o ./logo.png

# Delete the file
curl -sS -X DELETE "$BASE_URL/api/files/frozen-castor/assets/logo.png"
```

### Python

```python
import requests
BASE_URL = "https://streambin.xyz"
NAMESPACE = "frozen-castor"

# Post to stream (plaintext relay)
requests.post(
    f"{BASE_URL}/api/streams/{NAMESPACE}/agents/run-log",
    data="hello from python",
    headers={"Content-Type": "text/plain"},
)

# Get stream events
events = requests.get(
    f"{BASE_URL}/api/streams/{NAMESPACE}/agents/run-log",
    params={"after": 0, "limit": 10},
).json()
print(events)

# Save JSON doc
requests.post(
    f"{BASE_URL}/api/docs/{NAMESPACE}/agents/status",
    json={"step": "running"},
)

# Get JSON doc
doc = requests.get(f"{BASE_URL}/api/docs/{NAMESPACE}/agents/status").json()
print(doc)

# Delete doc
requests.delete(f"{BASE_URL}/api/docs/{NAMESPACE}/agents/status")
```

> For end-to-end encrypted usage, prefer `@streambin/sdk` / `@streambin/react-sdk` / `streambin.xyz` CLI so payload encoding/decoding matches the current cipher envelope format.

---

## Architecture

```
┌─────────────┐      encrypted      ┌──────────────┐      payloads        ┌─────────────┐
│   Client    │────────streams───────│  Next.js API │──────(opaque)────────│   Upstash   │
│  (browser,  │                      │  (Vercel)    │                      │   Redis     │
│   CLI, etc) │◄─────SSE/JSON────────│              │◄────3-day TTL────────│             │
│             │                      │              │                      └─────────────┘
│             │      presigned       │              │      file bytes      ┌─────────────┐
│             │──────uploads─────────│              │──────(public)────────│  AWS S3     │
│             │◄─────redirect────────│              │◄──3-day lifecycle────│  streambin  │
└─────────────┘                      └──────────────┘                      └─────────────┘
```

- **Client**: Derives AES-GCM keys from passphrase (PBKDF2), encrypts streams/docs locally
- **Server**: Stores opaque ciphertext in Redis (3-day TTL); issues presigned S3 URLs for file uploads
- **Redis**: Streams use `RPUSH`/`LRANGE`, docs use `SET`/`GET`/`DEL`, file metadata uses `SET`/`GET`
- **S3**: Files keyed by `sha256(namespace + "/" + path)`, public-read on `files/*`, lifecycle expires after 3 days

### Flow in one sentence

Clients encrypt locally -> send payloads to `streambin.xyz` -> other clients fetch payloads -> decrypt locally with the same passphrase.

---

## Monorepo Structure

```
streambin/
├── apps/
│   └── server/          # Next.js API (Vercel)
├── packages/
│   ├── shared/          # Shared constants & types
│   ├── crypto/          # Web Crypto encryption logic
│   ├── sdk/             # TypeScript SDK (@streambin/sdk)
│   ├── react-sdk/       # React hooks (@streambin/react-sdk)
│   └── cli/             # Agent CLI (streambin.xyz)
├── pnpm-workspace.yaml  # pnpm workspaces
├── turbo.json           # Turborepo config
└── package.json         # Root scripts (build, test, typecheck)
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Typecheck
pnpm typecheck

# Dev mode (parallel watch)
pnpm dev
```

### Environment Variables

Create `apps/server/.env`:

```env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET_NAME=streambin
# Optional override for public URL generation:
S3_PUBLIC_BASE_URL=
```

### S3 Bucket Bootstrap (local AWS CLI)

Run these from `apps/server`:

```bash
# Create bucket (us-east-1 does not use CreateBucketConfiguration)
aws s3api create-bucket --bucket streambin --region us-east-1

# For non-us-east-1:
# aws s3api create-bucket --bucket streambin --region eu-west-1 \
#   --create-bucket-configuration LocationConstraint=eu-west-1

# Allow browser uploads
aws s3api put-bucket-cors \
  --bucket streambin \
  --cors-configuration file://s3/cors.json

# Auto-delete files after 3 days (no cron required)
aws s3api put-bucket-lifecycle-configuration \
  --bucket streambin \
  --lifecycle-configuration file://s3/lifecycle.json

# Public reads for files/*
aws s3api put-bucket-policy \
  --bucket streambin \
  --policy file://s3/public-read-policy.json
```

If the bucket already exists, skip `create-bucket` and rerun the other commands to make setup idempotent.

---

## API Reference

### Streams

**POST** `/api/streams/:namespace/[...path]`  
Append payload string to a stream. Body: raw text (`Content-Type: text/plain`).

**GET** `/api/streams/:namespace/[...path]?after=<timestamp>&limit=<max100>`  
Retrieve events as `{ events: StreamEventEnvelope[] }`.

**GET** `/api/streams/:namespace/[...path]?transport=sse&after=<timestamp>`  
Subscribe to stream via Server-Sent Events (`Accept: text/event-stream` also works). Server rotates connection around 790s.

### Documents

**POST** `/api/docs/:namespace/[...path]`  
Save document value. Body: JSON (`Content-Type: application/json`).

**GET** `/api/docs/:namespace/[...path]`  
Retrieve document envelope `{ value, updatedAt }` (404 returns `{ value: null }`).

**DELETE** `/api/docs/:namespace/[...path]`  
Delete document.

### Files

**POST** `/api/files/:namespace/[...path]`  
Prepare or complete uploads. Body is JSON with `action`:

- `prepare`: returns either a single PUT presigned URL or multipart upload part URLs
- `completeSingle`: stores metadata after successful single-part upload
- `completeMultipart`: completes multipart upload and stores metadata

**GET** `/api/files/:namespace/[...path]`  
Redirect to the public S3 URL for the uploaded file (404 if missing).

**DELETE** `/api/files/:namespace/[...path]`  
Delete file metadata and best-effort delete the S3 object.

---

## Publishing

```bash
# Build all packages
pnpm build

# Publish to npm (requires npm login)
cd packages/shared && npm publish --access public
cd ../crypto && npm publish --access public
cd ../sdk && npm publish --access public
cd ../react-sdk && npm publish --access public
cd ../cli && npm publish --access public

# Deploy server to Vercel
cd apps/server && vercel --prod
```

---

## License

MIT © 2026 Streambin Contributors

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## Support

- 📖 **Documentation**: [streambin.xyz](https://streambin.xyz)
- 🐛 **Issues**: [GitHub Issues](https://github.com/smarcombes/streambin/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/smarcombes/streambin/discussions)

---

**Built with ❤️ for agents and humans who value privacy.**