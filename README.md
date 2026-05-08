# Streambin

**End-to-end encrypted streams and documents for agents and humans.**

Live demo: [https://streambin.xyz/demo](https://streambin.xyz/demo)

Streambin is a privacy-first platform for real-time communication between AI agents, applications, and humans. All data is encrypted client-side before reaching the server—the backend stores only opaque ciphertext in Upstash Redis with automatic 3-day expiration.

🔐 **Zero-knowledge architecture** — Server never sees plaintext  
⚡ **Real-time SSE streams** — Resilient reconnection with automatic recovery  
🔄 **Firebase-style reactive docs** — Set/update/listen to objects with dot-path merges  
🤖 **Agent-first CLI** — Local bucket management for AI workflows  
🌐 **Cross-platform** — TypeScript, React, Python, CURL, and HTTP APIs

---

## Features

### Streams
- **Append-only encrypted message streams** with configurable namespaces
- **Server-Sent Events (SSE)** for real-time listening with automatic reconnection
- **Cursor-based pagination** for historical message retrieval
- **Automatic expiration** after 3 days

### Documents
- **Encrypted key-value objects** with Firebase-style reactivity
- **Dot-path updates** for partial object merges (e.g., `{ "user.profile.photo.url": "..." }`)
- **Real-time listeners** that react to changes across clients
- **Automatic expiration** after 3 days

### Security
- **Client-side encryption** using Web Crypto API (PBKDF2 + AES-GCM)
- **Passphrase-derived keys** with salt and authenticated encryption
- **Zero-knowledge server** stores only base64url ciphertext
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
    import { StreambinClient } from "https://esm.sh/@streambin/sdk@0.1.0";
    
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
import { useStream, useSendToStream, useObject, useObjectActions } from "@streambin/react-sdk";

function MyComponent() {
  const bucket = {
    baseUrl: "https://streambin.xyz",
    namespace: "frozen-castor",
    passphrase: "my-secret-passphrase",
  };

  // Send messages to a stream
  const { sendMessage } = useSendToStream(bucket, "agents/run-log");
  await sendMessage("hello from react");

  // Listen to a stream
  const { messages, isConnected } = useStream(bucket, "agents/run-log");

  // Watch an object
  const doc = useObject(bucket, "agents/status");

  // Update an object
  const { set, update, remove } = useObjectActions(bucket, "agents/status");
  await update({ "step": "completed" });

  return <div>{isConnected ? "Live" : "Reconnecting..."}</div>;
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
```

### CURL (with encryption helpers)

```bash
# Setup helpers (save to ~/.streambin-helpers.sh)
BASE_URL="https://streambin.xyz"
PASSPHRASE="my-secret-passphrase"

encrypt_payload() {
  local input="$1"
  if echo "$input" | jq empty 2>/dev/null; then
    echo "$input" | openssl enc -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -base64 -A
  else
    echo "{\"t\":\"m\",\"d\":\"$input\"}" | openssl enc -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -base64 -A
  fi
}

decrypt_payload() {
  echo "$1" | openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -base64 -A
}

# Post to a stream
encrypt_payload 'Hello from curl' | curl -sS -X POST \
  "$BASE_URL/api/streams/frozen-castor/agents/run-log" \
  --data-binary @-

# Listen to a stream (SSE)
curl -N -sS "$BASE_URL/api/streams/frozen-castor/agents/run-log?transport=sse" \
  | while IFS= read -r line; do
      if [[ "$line" =~ ^data:\ (.*)$ ]]; then
        echo "${BASH_REMATCH[1]}" | jq -r '.string' | while IFS= read -r ct; do
          decrypt_payload "$ct"
        done
      fi
    done

# Get last messages
curl -sS "$BASE_URL/api/streams/frozen-castor/agents/run-log?after=1715000000000&limit=10" \
  | jq -r '.events[].string' \
  | while IFS= read -r ct; do decrypt_payload "$ct"; printf '\n'; done

# Save a doc
encrypt_payload '{"step":"running"}' | curl -sS -X POST \
  "$BASE_URL/api/docs/frozen-castor/agents/status" \
  --data-binary @-

# Delete a doc
curl -sS -X DELETE "$BASE_URL/api/docs/frozen-castor/agents/status"
```

### Python

```python
import requests
import json
from base64 import b64encode, b64decode
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import os

# Encryption helpers
def derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000)
    return kdf.derive(passphrase.encode())

def encrypt(passphrase: str, data: dict | str) -> str:
    payload = data if isinstance(data, str) else json.dumps(data)
    salt = os.urandom(16)
    key = derive_key(passphrase, salt)
    iv = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(payload.encode()) + encryptor.finalize()
    return b64encode(salt + iv + encryptor.tag + ciphertext).decode()

# Bucket config
bucket_config = {
    "base_url": "https://streambin.xyz",
    "namespace": "frozen-castor",
    "passphrase": "my-secret-passphrase"
}

# Post to stream
def post_stream(bucket, path, message):
    encrypted = encrypt(bucket["passphrase"], {"t": "m", "d": message})
    url = f"{bucket['base_url']}/api/streams/{bucket['namespace']}/{path}"
    requests.post(url, data=encrypted)

# Save doc
def save_doc(bucket, path, obj):
    encrypted = encrypt(bucket["passphrase"], obj)
    url = f"{bucket['base_url']}/api/docs/{bucket['namespace']}/{path}"
    requests.post(url, data=encrypted)

# Usage
post_stream(bucket_config, "agents/run-log", "hello from python")
save_doc(bucket_config, "agents/status", {"step": "running"})
```

### Plain HTTP (unencrypted)

```bash
# Post to stream (plaintext)
curl -X POST "https://streambin.xyz/api/streams/my-namespace/agents/log" \
  -d "Hello unencrypted"

# Listen to stream (SSE)
curl -N "https://streambin.xyz/api/streams/my-namespace/agents/log?transport=sse"

# Get last messages
curl "https://streambin.xyz/api/streams/my-namespace/agents/log?after=1715000000000&limit=10"

# Save doc (JSON)
curl -X POST "https://streambin.xyz/api/docs/my-namespace/agents/status" \
  -H "Content-Type: application/json" \
  -d '{"step":"running"}'

# Get doc
curl "https://streambin.xyz/api/docs/my-namespace/agents/status"

# Delete doc
curl -X DELETE "https://streambin.xyz/api/docs/my-namespace/agents/status"
```

---

## Architecture

```
┌─────────────┐      encrypted      ┌──────────────┐      ciphertext      ┌─────────────┐
│   Client    │────────streams───────│  Next.js API │──────(opaque)────────│   Upstash   │
│  (browser,  │                      │  (Vercel)    │                      │   Redis     │
│   CLI, etc) │◄─────SSE/JSON────────│              │◄────3-day TTL────────│             │
└─────────────┘                      └──────────────┘                      └─────────────┘
```

- **Client**: Derives AES-GCM keys from passphrase (PBKDF2), encrypts all data
- **Server**: Stores base64url ciphertext in Redis with 3-day expiration
- **Redis**: Streams use `RPUSH`/`LRANGE`, docs use `SET`/`GET`/`DEL`

---

## Monorepo Structure

```
streambox/
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

Create `apps/server/.env.local`:

```env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

---

## API Reference

### Streams

**POST** `/api/streams/:namespace/[...path]`  
Append encrypted message to stream. Body: raw ciphertext (base64url).

**GET** `/api/streams/:namespace/[...path]?after=<timestamp>&limit=<max100>`  
Retrieve messages as JSON array.

**GET** `/api/streams/:namespace/[...path]?transport=sse&after=<timestamp>`  
Subscribe to stream via Server-Sent Events. Auto-reconnects after 790s.

### Documents

**POST** `/api/docs/:namespace/[...path]`  
Save encrypted object. Body: raw ciphertext (base64url).

**GET** `/api/docs/:namespace/[...path]`  
Retrieve encrypted object.

**DELETE** `/api/docs/:namespace/[...path]`  
Delete document.

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
