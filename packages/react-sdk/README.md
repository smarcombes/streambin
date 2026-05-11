# @streambin/react-sdk

React hooks for [Streambin](https://streambin.xyz) — end-to-end encrypted streams and documents, plus public file uploads. Requires React 19+.

```bash
npm install @streambin/react-sdk
```

## Setup

Pass a "bucket" config to any hook, or share a single `StreambinClient` via `useStreambinClient`.

```tsx
const bucket = {
  baseUrl: "https://streambin.xyz",
  namespace: "frozen-castor",
  passphrase: "my-secret-passphrase",
};
```

## Streams

```tsx
import { useSendToStream, useStream } from "@streambin/react-sdk";

function Chat({ bucket }) {
  const { sendMessage } = useSendToStream(bucket, "chat/general");
  const { messages, connected } = useStream(bucket, "chat/general");

  return (
    <>
      <button onClick={() => sendMessage("hi")}>Send</button>
      <div>{connected ? "live" : "reconnecting..."}</div>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>{JSON.stringify(m.decoded.value)}</li>
        ))}
      </ul>
    </>
  );
}
```

## Documents

```tsx
import { useObject, useObjectActions } from "@streambin/react-sdk";

function Status({ bucket }) {
  const { value, loading } = useObject<{ step: string }>(bucket, "agents/status");
  const { set, update, remove } = useObjectActions(bucket, "agents/status");

  if (loading) return <span>loading...</span>;

  return (
    <>
      <pre>{JSON.stringify(value, null, 2)}</pre>
      <button onClick={() => update((current) => ({ ...(current ?? {}), step: "done" }))}>
        Mark done
      </button>
      <button onClick={() => remove()}>Delete</button>
    </>
  );
}
```

## Files

`useFileUpload(bucket, path)` returns an `uploadFile` function (handles single + multipart uploads), the stable `getFileUrl`, a `removeFile` action, and `uploading`/`error` state.

```tsx
import { useFileUpload } from "@streambin/react-sdk";

function AvatarUploader({ bucket, userId }) {
  const { uploadFile, getFileUrl, removeFile, uploading, error } =
    useFileUpload(bucket, `users/${userId}/avatar.png`);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadFile(file);
    console.log("public URL:", result.publicUrl);
  }

  return (
    <>
      <input type="file" accept="image/png" onChange={onChange} disabled={uploading} />
      <img src={getFileUrl()} alt="avatar" />
      <button onClick={() => removeFile()}>Remove</button>
      {error && <span style={{ color: "red" }}>{error.message}</span>}
    </>
  );
}
```

Notes:

- **Public**: files are not encrypted; anyone with the URL can read them.
- **3-day retention**: handled automatically by the storage backend (S3 lifecycle).
- **Idempotent paths**: uploading to the same path overwrites the file (its S3 key is `sha256(namespace + "/" + path)`).
- **Multipart**: automatic above ~8 MB; can be forced with `uploadFile(file, { multipart: { enabled: true } })`.

## Sharing one client

```tsx
import { useStreambinClient } from "@streambin/react-sdk";

const client = useStreambinClient(bucket);
const { uploadFile } = useFileUpload(client, "uploads/photo.jpg");
```

## License

MIT
