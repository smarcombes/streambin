"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type TabKey = "typescript" | "react" | "cli" | "curl" | "http" | "python";

type Variables = {
  namespace: string;
  path: string;
};

type TabAction = {
  id: string;
  title: string;
  language: "typescript" | "bash" | "http" | "python";
  render: (vars: Variables) => string;
};

type TabContent = {
  label: string;
  actions: TabAction[];
};

const STORAGE_KEY = "streambin:homepage:tab";
const DEFAULT_NAMESPACE = "frozen-castor";
const DEFAULT_PATH = "agents/run-log";

const TABS: Record<TabKey, TabContent> = {
  typescript: {
    label: "Node.js",
    actions: [
      {
        id: "create-bucket",
        title: "Create client",
        language: "typescript",
        render: ({ namespace }) => `import { StreambinClient } from "@streambin/sdk";

const bucketConfig = {
  baseUrl: "https://streambin.xyz",
  namespace: "${namespace}",
  passphrase: "my-secret-passphrase",
};

const client = new StreambinClient(bucketConfig);`,
      },
      {
        id: "post-stream",
        title: "Post to a stream",
        language: "typescript",
        render: ({ path }) => `await client.appendMessage("${path}", "hello");`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream",
        language: "typescript",
        render: ({ path }) => `const stop = client.listenStream("${path}", (message) => {
  console.log(message);
});`,
      },
      {
        id: "get-last-messages",
        title: "Get the last messages received after timestamp",
        language: "typescript",
        render: ({ path }) => `const events = await client.getStream("${path}", {
  after: 1715000000000,
  limit: 10,
});`,
      },
      {
        id: "save-doc",
        title: "Save a doc",
        language: "typescript",
        render: ({ path }) => `await client.setObject("${path}", { step: "running" });`,
      },
      {
        id: "watch-doc",
        title: "Watch doc for changes",
        language: "typescript",
        render: ({ path }) => `const stop = client.listenObject("${path}", (value) => {
  console.log("doc changed", value);
});`,
      },
      {
        id: "update-doc",
        title: "Update a doc",
        language: "typescript",
        render: ({ path }) => `await client.updateObject<Record<string, unknown>>("${path}", (current) => ({
  ...(current ?? {}),
  attempts: ((current?.attempts as number | undefined) ?? 0) + 1,
}));`,
      },
      {
        id: "delete-doc",
        title: "Delete a doc",
        language: "typescript",
        render: ({ path }) => `await client.removeObject("${path}");`,
      },
    ],
  },
  react: {
    label: "React Hooks",
    actions: [
      {
        id: "create-client",
        title: "Create a bucket object",
        language: "typescript",
        render: ({ namespace }) => `const bucket = {
  // baseUrl: "https://streambin.xyz",
  namespace: "${namespace}",
  passphrase: "my-secret-passphrase",
};`,
      },
      {
        id: "send-stream",
        title: "Post to a stream",
        language: "typescript",
        render: ({ path }) => `import { useSendToStream } from "@streambin/react-sdk";

const { sendMessage } = useSendToStream(bucket, "${path}");
await sendMessage("hello from react");`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream",
        language: "typescript",
        render: ({ path }) => `import { useStream } from "@streambin/react-sdk";

const { messages, connected } = useStream(bucket, "${path}", { mode: "both" });
console.log(connected, messages.at(-1)?.decoded.value);`,
      },
      {
        id: "watch-doc",
        title: "Watch doc value",
        language: "typescript",
        render: ({ path }) => `import { useObject } from "@streambin/react-sdk";

const { value, loading } = useObject<Record<string, unknown>>(bucket, "${path}");
console.log(loading, value);`,
      },
      {
        id: "update-doc",
        title: "Save/update/delete doc",
        language: "typescript",
        render: ({ path }) => `import { useObjectActions } from "@streambin/react-sdk";

const { set, update, remove } = useObjectActions<Record<string, unknown>>(bucket, "${path}");
await set({ step: "running" });
await update((current) => ({ ...(current ?? {}), attempts: ((current?.attempts as number | undefined) ?? 0) + 1 }));
await remove();`,
      },
    ],
  },
  cli: {
    label: "CLI",
    actions: [
      {
        id: "create-bucket",
        title: "Create a bucket (random namespace + passphrase)",
        language: "bash",
        render: () => `npx streambin.xyz create
# optional custom slug
npx streambin.xyz create frozen-castor
# fully explicit
npx streambin.xyz create --name frozen-castor --namespace my-namespace --passphrase my-secret-phrase`,
      },
      {
        id: "list-buckets",
        title: "List local buckets",
        language: "bash",
        render: () => `npx streambin.xyz list`,
      },
      {
        id: "export-bucket",
        title: "Export selected bucket for another machine",
        language: "bash",
        render: () => `npx streambin.xyz export
# prints: npx streambin.xyz import frozen-castor@<namespace>::<passphrase>`,
      },
      {
        id: "post-stream",
        title: "Post to a stream",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz send ${path} "hello"`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz tail ${path}`,
      },
      {
        id: "get-last-messages",
        title: "Get the last messages received after timestamp",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz get ${path} --after 1715000000000 --limit 10`,
      },
      {
        id: "save-doc",
        title: "Save a doc",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz set-object ${path} '{"step":"running"}'`,
      },
      {
        id: "watch-doc",
        title: "Watch doc for changes",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz listen-object ${path}`,
      },
      {
        id: "update-doc",
        title: "Update a doc",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz update-object ${path} '{"attempts":2}'`,
      },
      {
        id: "delete-doc",
        title: "Delete a doc",
        language: "bash",
        render: ({ path }) => `npx streambin.xyz remove-object ${path}`,
      },
    ],
  },
  curl: {
    label: "CURL",
    actions: [
      {
        id: "create-bucket",
        title: "Create curl config + helpers",
        language: "bash",
        render: ({ namespace }) => `BASE_URL="https://streambin.xyz"
PASSPHRASE="my-secret-passphrase"

encrypt_payload() {
  # Usage:
  #   encrypt_payload 'Hello'
  #   encrypt_payload '{"message":"Hello"}'
  local input="$1"
  local payload="$input"
  if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
    payload="{\\"t\\":\\"m\\",\\"d\\":\\"$input\\"}"
  fi
  printf '%s' "$payload" | openssl enc -aes-256-cbc -pbkdf2 -salt -a -A -pass "pass:$PASSPHRASE"
}

decrypt_payload() {
  printf '%s' "$1" | openssl enc -d -aes-256-cbc -pbkdf2 -a -A -pass "pass:$PASSPHRASE"
}

decrypt_stream() {
  while IFS= read -r line; do
    if [[ "$line" == data:* ]]; then
      local event_json="\${line#data: }"
      local ciphertext
      ciphertext="$(printf '%s' "$event_json" | jq -r '.string // empty')"
      if [[ -n "$ciphertext" ]]; then
        decrypt_payload "$ciphertext"
        printf '\\n'
      fi
    fi
  done
}

decrypt_events_json() {
  jq -r '.events[].string' | while IFS= read -r ciphertext; do
    decrypt_payload "$ciphertext"
    printf '\\n'
  done
}`,
      },
      {
        id: "post-stream",
        title: "Post to a stream",
        language: "bash",
        render: ({ namespace, path }) =>
          `encrypt_payload 'Hello' | curl -sS -X POST "$BASE_URL/api/streams/${namespace}/${path}" \\
  -H "content-type: text/plain" \\
  --data-binary @-
# or:
# encrypt_payload '{"message":"Hello"}' | curl -sS -X POST "$BASE_URL/api/streams/${namespace}/${path}" -H "content-type: text/plain" --data-binary @-`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream",
        language: "bash",
        render: ({ namespace, path }) => `curl -N -sS "$BASE_URL/api/streams/${namespace}/${path}?transport=sse&after=0" \\
  -H "accept: text/event-stream" | decrypt_stream`,
      },
      {
        id: "get-last-messages",
        title: "Get the last messages received after timestamp",
        language: "bash",
        render: ({ namespace, path }) =>
          `curl -sS "$BASE_URL/api/streams/${namespace}/${path}?after=1715000000000&limit=10" \\
  | decrypt_events_json`,
      },
      {
        id: "save-doc",
        title: "Save a doc",
        language: "bash",
        render: ({ namespace, path }) =>
          `encrypt_payload '{"step":"running"}' | curl -sS -X POST "$BASE_URL/api/docs/${namespace}/${path}" \\
  -H "content-type: application/json" \\
  --data-binary @-`,
      },
      {
        id: "watch-doc",
        title: "Watch doc for changes",
        language: "bash",
        render: ({ namespace, path }) => `curl -N -sS "$BASE_URL/api/streams/${namespace}/${path}?transport=sse&after=0" \\
  -H "accept: text/event-stream" | decrypt_stream`,
      },
      {
        id: "update-doc",
        title: "Update a doc",
        language: "bash",
        render: ({ namespace, path }) =>
          `encrypt_payload '{"attempts":2,"photo.url":"https://example.com/p.jpg"}' | curl -sS -X POST "$BASE_URL/api/docs/${namespace}/${path}" \\
  -H "content-type: application/json" \\
  --data-binary @-`,
      },
      {
        id: "delete-doc",
        title: "Delete a doc",
        language: "bash",
        render: ({ namespace, path }) => `curl -sS -X DELETE "$BASE_URL/api/docs/${namespace}/${path}"`,
      },
    ],
  },
  http: {
    label: "HTTP",
    actions: [
      {
        id: "config",
        title: "Base config (unencrypted examples)",
        language: "http",
        render: ({ namespace }) => `Base URL: https://streambin.xyz
Namespace: ${namespace}
Path: agents/run-log`,
      },
      {
        id: "post-stream",
        title: "Post to a stream (plain text)",
        language: "http",
        render: ({ namespace, path }) => `POST /api/streams/${namespace}/${path}
Content-Type: text/plain

hello`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream (SSE)",
        language: "http",
        render: ({ namespace, path }) => `GET /api/streams/${namespace}/${path}?transport=sse&after=0
Accept: text/event-stream`,
      },
      {
        id: "get-messages",
        title: "Get last messages since timestamp",
        language: "http",
        render: ({ namespace, path }) => `GET /api/streams/${namespace}/${path}?after=1715000000000&limit=10`,
      },
      {
        id: "save-doc",
        title: "Save doc (plain JSON)",
        language: "http",
        render: ({ namespace, path }) => `POST /api/docs/${namespace}/${path}
Content-Type: application/json

{"step":"running"}`,
      },
      {
        id: "get-doc",
        title: "Get doc",
        language: "http",
        render: ({ namespace, path }) => `GET /api/docs/${namespace}/${path}`,
      },
      {
        id: "delete-doc",
        title: "Delete doc",
        language: "http",
        render: ({ namespace, path }) => `DELETE /api/docs/${namespace}/${path}`,
      },
    ],
  },
  python: {
    label: "Python",
    actions: [
      {
        id: "create-bucket",
        title: "Create a bucket config + helpers",
        language: "python",
        render: ({ namespace }) => `# pip install cryptography requests
import base64
import hashlib
import json
import os
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

bucket_config = {
  "base_url": "https://streambin.xyz",
  "namespace": "${namespace}",
  "passphrase": "my-secret-passphrase",
}

def _b64url(data: bytes) -> str:
  return base64.urlsafe_b64encode(data).decode().rstrip("=")

def _from_b64url(value: str) -> bytes:
  return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def encrypt_payload(bucket: dict, payload) -> dict:
  salt = os.urandom(16)
  iv = os.urandom(12)
  key = hashlib.pbkdf2_hmac("sha256", bucket["passphrase"].encode(), salt, 310000, dklen=32)
  aes = AESGCM(key)
  ciphertext = aes.encrypt(iv, json.dumps(payload).encode(), None)
  return {
    "v": 1, "alg": "AES-GCM", "kdf": "PBKDF2", "hash": "SHA-256",
    "iterations": 310000,
    "salt": _b64url(salt),
    "iv": _b64url(iv),
    "ciphertext": _b64url(ciphertext),
  }

def decrypt_payload(bucket: dict, envelope: dict):
  key = hashlib.pbkdf2_hmac(
    "sha256",
    bucket["passphrase"].encode(),
    _from_b64url(envelope["salt"]),
    int(envelope["iterations"]),
    dklen=32,
  )
  aes = AESGCM(key)
  plaintext = aes.decrypt(
    _from_b64url(envelope["iv"]),
    _from_b64url(envelope["ciphertext"]),
    None,
  )
  return json.loads(plaintext.decode())

def send_message(bucket: dict, path: str, message: str):
  envelope = encrypt_payload(bucket, {"t": "m", "d": message})
  return requests.post(
    f"{bucket['base_url']}/api/streams/{bucket['namespace']}/{path}",
    data=json.dumps(envelope),
    headers={"content-type": "text/plain"},
  )

def save_doc(bucket: dict, path: str, value):
  envelope = encrypt_payload(bucket, value)
  return requests.post(
    f"{bucket['base_url']}/api/docs/{bucket['namespace']}/{path}",
    json=envelope,
  )

def get_messages(bucket: dict, path: str, after=0, limit=10):
  response = requests.get(
    f"{bucket['base_url']}/api/streams/{bucket['namespace']}/{path}",
    params={"after": after, "limit": limit},
  )
  events = response.json()["events"]
  return [decrypt_payload(bucket, json.loads(event["string"])) for event in events]

def get_doc(bucket: dict, path: str):
  response = requests.get(f"{bucket['base_url']}/api/docs/{bucket['namespace']}/{path}")
  if response.status_code == 404:
    return None
  return decrypt_payload(bucket, response.json()["value"])

def listen_stream(bucket: dict, path: str, after=0):
  with requests.get(
    f"{bucket['base_url']}/api/streams/{bucket['namespace']}/{path}",
    params={"transport": "sse", "after": after},
    stream=True,
  ) as response:
    for line in response.iter_lines(decode_unicode=True):
      if line and line.startswith("data: "):
        yield json.loads(line[6:])`,
      },
      {
        id: "post-stream",
        title: "Post to a stream",
        language: "python",
        render: ({ path }) => `send_message(bucket_config, "${path}", "hello")`,
      },
      {
        id: "listen-stream",
        title: "Listen to a stream",
        language: "python",
        render: ({ path }) => `for event in listen_stream(bucket_config, "${path}", after=0):
  print(event)`,
      },
      {
        id: "get-last-messages",
        title: "Get the last messages received after timestamp",
        language: "python",
        render: ({ path }) => `messages = get_messages(bucket_config, "${path}", after=1715000000000, limit=10)
print(messages)`,
      },
      {
        id: "save-doc",
        title: "Save a doc",
        language: "python",
        render: ({ path }) => `save_doc(bucket_config, "${path}", {"step": "running"})`,
      },
      {
        id: "watch-doc",
        title: "Watch doc for changes",
        language: "python",
        render: ({ path }) => `for event in listen_stream(bucket_config, "${path}", after=0):
  print("doc changed", event)`,
      },
      {
        id: "update-doc",
        title: "Update a doc",
        language: "python",
        render: ({ path }) => `current = get_doc(bucket_config, "${path}") or {}
current["attempts"] = int(current.get("attempts", 0)) + 1
save_doc(bucket_config, "${path}", current)`,
      },
      {
        id: "delete-doc",
        title: "Delete a doc",
        language: "python",
        render: ({ path }) => `save_doc(bucket_config, "${path}", {"__streambin_deleted": True})`,
      },
    ],
  },
};

function highlighterLanguage(language: TabAction["language"]): string {
  if (language === "http") {
    return "http";
  }
  return language;
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function HomeTabs() {
  const [active, setActive] = useState<TabKey>("typescript");
  const [namespace, setNamespace] = useState(DEFAULT_NAMESPACE);
  const [path, setPath] = useState(DEFAULT_PATH);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as TabKey | null;
    if (stored && stored in TABS) {
      setActive(stored);
    }
  }, []);

  const tab = TABS[active];
  const vars = useMemo(() => ({ namespace, path }), [namespace, path]);

  const switchTab = (next: TabKey) => {
    setActive(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const onCopy = async (key: string, value: string) => {
    try {
      await copyToClipboard(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <section className="w-full rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-black/70">
      <div className="mb-4 grid gap-3 rounded-lg border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-black/40 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="namespace-input">Namespace</Label>
          <Input
            id="namespace-input"
            value={namespace}
            onChange={(event) => setNamespace(event.target.value.trim())}
            placeholder="frozen-castor"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="path-input">Path</Label>
          <Input
            id="path-input"
            value={path}
            onChange={(event) => setPath(event.target.value.trim())}
            placeholder="agents/run-log"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TABS) as TabKey[]).map((key) => (
            <Button
              key={key}
              variant={active === key ? "default" : "outline"}
              size="sm"
              onClick={() => switchTab(key)}
            >
              {TABS[key].label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {tab.actions.map((action) => {
          const snippet = action.render(vars);
          const blockKey = `${active}:${action.id}`;

          return (
            <article key={action.id} className="rounded-xl border border-white/10 bg-black/80 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">{action.title}</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 w-10 border-white/20 p-0 text-white hover:bg-white/10"
                  onClick={() => onCopy(blockKey, snippet)}
                  aria-label={copiedKey === blockKey ? "Copied" : "Copy snippet"}
                  title={copiedKey === blockKey ? "Copied" : "Copy snippet"}
                >
                  {copiedKey === blockKey ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </Button>
              </div>
              <div className="overflow-auto rounded-md">
                <SyntaxHighlighter
                  language={highlighterLanguage(action.language)}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    padding: "0.75rem",
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                    lineHeight: 1.6,
                    background: "transparent",
                  }}
                  codeTagProps={{ style: { fontFamily: "var(--font-geist-mono)" } }}
                  wrapLongLines
                >
                  {snippet}
                </SyntaxHighlighter>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
