import { describe, expect, it, vi } from "vitest";
import {
  GCM_TAG_SIZE,
  SBF1_HEADER_SIZE,
  SBF2_HEADER_SIZE,
  decryptBytes,
  encryptBytes,
  encryptJson,
  readEncryptedFileFormat,
} from "@streambin/crypto";
import { StreambinClient } from "./index";

const TEXT = new TextDecoder();

function makePlaintext(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 7 + 3) & 0xff;
  }
  return bytes;
}

function readBytesFromBody(body: BodyInit | null | undefined): Uint8Array {
  if (!body) {
    throw new Error("Missing PUT body");
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error("Unsupported PUT body type");
}

describe("sdk streams + docs", () => {
  it("filters and decodes stream messages", async () => {
    const payload = await encryptJson("pw", { t: "m", d: "hello" });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          events: [
            {
              event: "message",
              id: "1",
              timestamp: 1,
              string: JSON.stringify(payload),
            },
          ],
        }),
      );
    });

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const events = await client.getStream("chat/general", { mode: "message" });
    expect(events).toHaveLength(1);
    expect(events[0].decoded).toEqual({ type: "message", value: "hello" });
  });

  it("checks object changes from object stream", async () => {
    const payload = await encryptJson("pw", { foo: "bar" });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          events: [
            {
              event: "message",
              id: "1",
              timestamp: 101,
              string: JSON.stringify(payload),
            },
          ],
        }),
      );
    });

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.hasObjectChangedSince("state/current", 100)).resolves.toBe(true);
  });

  it("applies firebase-style patch updates with dotted paths", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: await encryptJson("pw", { firstName: "Ada", lastName: "Lovelace" }),
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const updated = await client.updateObject<Record<string, unknown>>("profile", {
      firstName: "Ada",
      age: 36,
      "photo.url": "https://example.test/photo.jpg",
    });

    expect(updated).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      age: 36,
      photo: { url: "https://example.test/photo.jpg" },
    });
  });

  it("upserts on updateObject when doc GET returns 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const updated = await client.updateObject<Record<string, unknown>>("profile", {
      firstName: "Ada",
      "photo.url": "https://example.test/photo.jpg",
    });

    expect(updated).toEqual({
      firstName: "Ada",
      photo: { url: "https://example.test/photo.jpg" },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://example.test/api/docs/ns/profile");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("removeObject writes tombstone then deletes doc", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.removeObject("profile");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});

describe("sdk files (encrypted by default)", () => {
  it("encrypts and uploads small files via SBF1 single PUT", async () => {
    const plaintext = makePlaintext(64);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mode: "single",
            fileId: "abc",
            key: "files/abc",
            method: "PUT",
            url: "https://upload.example.test/single",
            contentType: "application/octet-stream",
            expiresIn: 900,
            publicUrl: "https://streambin.s3.amazonaws.com/files/abc",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: "abc",
            key: "files/abc",
            publicUrl: "https://streambin.s3.amazonaws.com/files/abc",
            contentType: "application/octet-stream",
            originalContentType: "image/png",
            encrypted: true,
            size: SBF1_HEADER_SIZE + 64 + GCM_TAG_SIZE,
            updatedAt: 1,
          }),
          { status: 200 },
        ),
      );

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.uploadFile("assets/logo.png", plaintext, {
      contentType: "image/png",
    });

    expect(result.encrypted).toBe(true);
    expect(result.originalContentType).toBe("image/png");

    const prepareCall = fetchImpl.mock.calls[0];
    const prepareBody = JSON.parse((prepareCall[1] as RequestInit).body as string);
    expect(prepareBody).toMatchObject({
      action: "prepare",
      encrypted: true,
      originalContentType: "image/png",
      contentType: "application/octet-stream",
    });
    expect(prepareBody.size).toBe(SBF1_HEADER_SIZE + 64 + GCM_TAG_SIZE);

    const putBody = readBytesFromBody((fetchImpl.mock.calls[1][1] as RequestInit).body as BodyInit);
    expect(readEncryptedFileFormat(putBody)).toBe("SBF1");
    expect(putBody.length).toBe(SBF1_HEADER_SIZE + 64 + GCM_TAG_SIZE);
    const decrypted = await decryptBytes("pw", putBody);
    expect(decrypted).toEqual(plaintext);

    const completeBody = JSON.parse(
      (fetchImpl.mock.calls[2][1] as RequestInit).body as string,
    );
    expect(completeBody).toMatchObject({
      action: "completeSingle",
      encrypted: true,
      originalContentType: "image/png",
    });
  });

  it("never sends the passphrase in any request body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mode: "single",
            fileId: "abc",
            key: "files/abc",
            method: "PUT",
            url: "https://upload.example.test/single",
            contentType: "application/octet-stream",
            expiresIn: 900,
            publicUrl: "https://streambin.s3.amazonaws.com/files/abc",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: "abc",
            key: "files/abc",
            publicUrl: "https://streambin.s3.amazonaws.com/files/abc",
            contentType: "application/octet-stream",
            originalContentType: "text/plain",
            encrypted: true,
            size: SBF1_HEADER_SIZE + 11 + GCM_TAG_SIZE,
            updatedAt: 1,
          }),
          { status: 200 },
        ),
      );

    const secret = "super-secret-passphrase-XYZ";
    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: secret,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.uploadFile("notes/hi.txt", new TextEncoder().encode("hello world"), {
      contentType: "text/plain",
    });

    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      if (!init?.body) continue;
      if (typeof init.body === "string") {
        expect(init.body).not.toContain(secret);
      } else {
        const bytes = readBytesFromBody(init.body as BodyInit);
        const asText = TEXT.decode(bytes);
        expect(asText).not.toContain(secret);
      }
    }
  });

  it("encrypts and uploads large files via SBF2 multipart", async () => {
    const chunkSize = 16; // for testing, small
    const plaintext = makePlaintext(chunkSize * 2 + 5); // 3 chunks
    const partCount = 3;
    const fetchImpl = vi.fn();

    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mode: "multipart",
          fileId: "multi",
          key: "files/multi",
          uploadId: "up-1",
          contentType: "application/octet-stream",
          partSize: chunkSize,
          parts: [
            { partNumber: 1, url: "https://upload.example.test/p1" },
            { partNumber: 2, url: "https://upload.example.test/p2" },
            { partNumber: 3, url: "https://upload.example.test/p3" },
          ],
          expiresIn: 900,
          publicUrl: "https://streambin.s3.amazonaws.com/files/multi",
        }),
        { status: 201 },
      ),
    );
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: "\"e1\"" } }));
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: "\"e2\"" } }));
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: "\"e3\"" } }));
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fileId: "multi",
          key: "files/multi",
          publicUrl: "https://streambin.s3.amazonaws.com/files/multi",
          contentType: "application/octet-stream",
          originalContentType: "application/octet-stream",
          encrypted: true,
          size: SBF2_HEADER_SIZE + plaintext.byteLength + partCount * GCM_TAG_SIZE,
          updatedAt: 2,
        }),
        { status: 200 },
      ),
    );

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.uploadFile("archive.bin", plaintext, {
      chunkSize,
      multipart: { enabled: true },
    });

    expect(result.encrypted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    const part1 = readBytesFromBody((fetchImpl.mock.calls[1][1] as RequestInit).body as BodyInit);
    const part2 = readBytesFromBody((fetchImpl.mock.calls[2][1] as RequestInit).body as BodyInit);
    const part3 = readBytesFromBody((fetchImpl.mock.calls[3][1] as RequestInit).body as BodyInit);

    expect(readEncryptedFileFormat(part1)).toBe("SBF2");
    expect(part1.byteLength).toBe(SBF2_HEADER_SIZE + chunkSize + GCM_TAG_SIZE);
    expect(part2.byteLength).toBe(chunkSize + GCM_TAG_SIZE);
    expect(part3.byteLength).toBe(5 + GCM_TAG_SIZE);

    const completeBody = JSON.parse(
      (fetchImpl.mock.calls[4][1] as RequestInit).body as string,
    );
    expect(completeBody.action).toBe("completeMultipart");
    expect(completeBody.encrypted).toBe(true);
    expect(completeBody.parts).toHaveLength(3);
  });

  it("roundtrips SBF2 multipart end-to-end via uploadFile + downloadFile", async () => {
    const chunkSize = 16;
    const plaintext = makePlaintext(chunkSize * 2 + 5);

    let storedBody: Uint8Array | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("?meta=1") && method === "GET") {
        return new Response(
          JSON.stringify({
            fileId: "rt",
            key: "files/rt",
            publicUrl: "https://s3.test/files/rt",
            contentType: "application/octet-stream",
            originalContentType: "application/octet-stream",
            encrypted: true,
            size: storedBody?.byteLength ?? 0,
            updatedAt: 1,
          }),
        );
      }

      if (url === "https://s3.test/files/rt" && method === "GET") {
        if (!storedBody) {
          return new Response(null, { status: 404 });
        }
        return new Response(storedBody.buffer as ArrayBuffer, { status: 200 });
      }

      if (url.endsWith("/api/files/ns/roundtrip.bin") && method === "POST") {
        const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        if (body.action === "prepare") {
          return new Response(
            JSON.stringify({
              mode: "multipart",
              fileId: "rt",
              key: "files/rt",
              uploadId: "u-rt",
              contentType: "application/octet-stream",
              partSize: chunkSize,
              parts: [
                { partNumber: 1, url: "https://s3.test/upload/p1" },
                { partNumber: 2, url: "https://s3.test/upload/p2" },
                { partNumber: 3, url: "https://s3.test/upload/p3" },
              ],
              expiresIn: 900,
              publicUrl: "https://s3.test/files/rt",
            }),
            { status: 201 },
          );
        }
        if (body.action === "completeMultipart") {
          return new Response(
            JSON.stringify({
              fileId: "rt",
              key: "files/rt",
              publicUrl: "https://s3.test/files/rt",
              contentType: "application/octet-stream",
              originalContentType: "application/octet-stream",
              encrypted: true,
              size: storedBody?.byteLength ?? 0,
              updatedAt: 1,
            }),
          );
        }
      }

      if (url.startsWith("https://s3.test/upload/") && method === "PUT") {
        const bodyBytes = readBytesFromBody(init?.body as BodyInit);
        if (!storedBody) {
          storedBody = new Uint8Array(0);
        }
        const next = new Uint8Array(storedBody.byteLength + bodyBytes.byteLength);
        next.set(storedBody, 0);
        next.set(bodyBytes, storedBody.byteLength);
        storedBody = next;
        return new Response(null, { status: 200, headers: { ETag: `"e-${url.slice(-2)}"` } });
      }

      return new Response(null, { status: 404 });
    });

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.uploadFile("roundtrip.bin", plaintext, {
      chunkSize,
      multipart: { enabled: true },
    });

    expect(storedBody).not.toBeNull();
    expect(readEncryptedFileFormat(storedBody!)).toBe("SBF2");

    const downloaded = await client.downloadFile("roundtrip.bin");
    expect(downloaded).not.toBeNull();
    expect(downloaded?.encrypted).toBe(true);
    expect(downloaded?.bytes).toEqual(plaintext);
  });

  it("uploads as plaintext when encrypted=false is set", async () => {
    const plaintext = new TextEncoder().encode("plain text payload");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mode: "single",
            fileId: "p",
            key: "files/p",
            method: "PUT",
            url: "https://upload.example.test/p",
            contentType: "text/plain",
            expiresIn: 900,
            publicUrl: "https://streambin.s3.amazonaws.com/files/p",
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: "p",
            key: "files/p",
            publicUrl: "https://streambin.s3.amazonaws.com/files/p",
            contentType: "text/plain",
            originalContentType: "text/plain",
            encrypted: false,
            size: plaintext.byteLength,
            updatedAt: 1,
          }),
          { status: 200 },
        ),
      );

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.uploadFile("plain.txt", plaintext, {
      encrypted: false,
      contentType: "text/plain",
    });

    expect(result.encrypted).toBe(false);

    const prepareBody = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(prepareBody.encrypted).toBe(false);

    const putBody = readBytesFromBody((fetchImpl.mock.calls[1][1] as RequestInit).body as BodyInit);
    expect(putBody).toEqual(plaintext);
  });

  it("downloadFile decrypts an SBF1 single-shot file", async () => {
    const plaintext = makePlaintext(32);
    const ciphertext = await encryptBytes("pw", plaintext);

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: "x",
            key: "files/x",
            publicUrl: "https://s3.test/files/x",
            contentType: "application/octet-stream",
            originalContentType: "image/png",
            encrypted: true,
            size: ciphertext.byteLength,
            updatedAt: 1,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(ciphertext.buffer as ArrayBuffer, { status: 200 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.downloadFile("assets/logo.png");
    expect(result).not.toBeNull();
    expect(result?.encrypted).toBe(true);
    expect(result?.contentType).toBe("image/png");
    expect(result?.bytes).toEqual(plaintext);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://example.test/api/files/ns/assets/logo.png?meta=1");
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://s3.test/files/x");
  });

  it("downloadFile returns null for a missing file", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.downloadFile("missing");
    expect(result).toBeNull();
  });
});
