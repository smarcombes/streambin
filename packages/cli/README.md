# streambin.xyz

Agent-first CLI for [Streambin](https://streambin.xyz) — encrypted streams and documents, plus public file uploads (3-day retention) — all from the terminal.

```bash
npx streambin.xyz <command>
# also available as `streambin`
```

The CLI stores buckets at `~/.streambin/config.json` and read cursors at `~/.streambin/state.json`.

## Buckets

```bash
# Create a bucket (random namespace + passphrase if not provided)
npx streambin.xyz create frozen-castor

# List local buckets (`*` is the selected one)
npx streambin.xyz list

# Switch to another bucket
npx streambin.xyz use frozen-castor

# Show the currently selected bucket
npx streambin.xyz current

# Print a one-line import token to share between machines
npx streambin.xyz export frozen-castor

# Import from a token
npx streambin.xyz import "frozen-castor@my-ns::my-passphrase"
```

Pass `--base-url https://your-host` on `create`/`import` to target a self-hosted server.

## Streams

```bash
# Append an encrypted message
npx streambin.xyz send agents/run-log "deployment started"

# Tail a stream (polling, persists cursor between runs)
npx streambin.xyz tail agents/run-log

# Get historic events
npx streambin.xyz get agents/run-log --after 1715000000000 --limit 10 --mode both
```

## Documents

```bash
# Save / update / read / delete an encrypted JSON document
npx streambin.xyz set-object agents/status '{"step":"running"}'
npx streambin.xyz update-object agents/status '{"progress.percent":75}'
npx streambin.xyz get-object agents/status
npx streambin.xyz remove-object agents/status

# Listen for changes (real-time)
npx streambin.xyz listen-object agents/status

# Check if a doc changed since a timestamp
npx streambin.xyz changed-since agents/status 1715000000000
```

## Files

Public file uploads, deterministically named by `sha256(namespace + "/" + path)`. The storage backend deletes files automatically after 3 days.

```bash
# Upload a local file to a namespaced path
npx streambin.xyz upload-file assets/logo.png ./logo.png

# Override the content type
npx streambin.xyz upload-file reports/q4.csv ./q4.csv \
  --content-type "text/csv; charset=utf-8"

# Force multipart upload (otherwise auto for files >= 8 MB)
npx streambin.xyz upload-file archives/dump.bin ./dump.bin --multipart

# Print the stable URL for a file (redirects to its public S3 URL)
npx streambin.xyz file-url assets/logo.png

# Download a file
npx streambin.xyz download-file assets/logo.png ./logo.png

# Delete a file (metadata + S3 object)
npx streambin.xyz remove-file assets/logo.png
```

`upload-file` outputs the upload result as JSON, including the public URL:

```json
{
  "fileId": "9f3b...e1",
  "key": "files/9f3b...e1",
  "publicUrl": "https://streambin.s3.amazonaws.com/files/9f3b...e1",
  "contentType": "image/png",
  "size": 12345,
  "updatedAt": 1747000000000
}
```

## Environment

- `STREAMBIN_BASE_URL` — override the default base URL (`https://streambin.xyz`).

## License

MIT
