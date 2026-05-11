import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_CHUNK_SIZE_BYTES,
  FileStreamDecryptor,
  FileStreamEncryptor,
  GCM_TAG_SIZE,
  SBF1_HEADER_SIZE,
  SBF2_HEADER_SIZE,
  decryptBytes,
  decryptJson,
  decryptString,
  encryptBytes,
  encryptJson,
  encryptString,
  isCipherEnvelope,
  isEncryptedFileBlob,
  readEncryptedFileFormat,
} from "./index";

function randomPlaintext(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 31 + 7) & 0xff;
  }
  return bytes;
}

async function streamEncrypt(
  passphrase: string,
  plaintext: Uint8Array,
  chunkSize: number,
): Promise<{ header: Uint8Array; chunks: Uint8Array[] }> {
  const encryptor = new FileStreamEncryptor(passphrase, plaintext.byteLength, chunkSize);
  const header = encryptor.initHeader();
  const chunks: Uint8Array[] = [];

  if (plaintext.byteLength === 0) {
    chunks.push(await encryptor.encryptChunk(plaintext, true));
    return { header, chunks };
  }

  let offset = 0;
  while (offset < plaintext.byteLength) {
    const end = Math.min(offset + chunkSize, plaintext.byteLength);
    const isLast = end === plaintext.byteLength;
    const chunk = plaintext.subarray(offset, end);
    chunks.push(await encryptor.encryptChunk(chunk, isLast));
    offset = end;
  }
  return { header, chunks };
}

async function streamDecrypt(
  passphrase: string,
  header: Uint8Array,
  chunks: Uint8Array[],
): Promise<Uint8Array> {
  const decryptor = new FileStreamDecryptor(passphrase);
  const info = decryptor.consumeHeader(header);
  const out = new Uint8Array(info.totalSize);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    const plaintext = await decryptor.decryptChunk(chunks[i], isLast);
    out.set(plaintext, offset);
    offset += plaintext.byteLength;
  }
  return out;
}

describe("crypto string/json", () => {
  it("encrypts and decrypts strings", async () => {
    const encrypted = await encryptString("correct horse", "hello world");
    const decrypted = await decryptString("correct horse", encrypted);
    expect(decrypted).toBe("hello world");
  });

  it("encrypts and decrypts json", async () => {
    const encrypted = await encryptJson("passphrase", { ok: true, count: 3 });
    const decrypted = await decryptJson<{ ok: boolean; count: number }>("passphrase", encrypted);
    expect(decrypted).toEqual({ ok: true, count: 3 });
  });

  it("fails with a wrong passphrase", async () => {
    const encrypted = await encryptString("right", "secret");
    await expect(decryptString("wrong", encrypted)).rejects.toThrow();
  });

  it("detects valid envelopes", async () => {
    const encrypted = await encryptString("pw", "payload");
    expect(isCipherEnvelope(encrypted)).toBe(true);
    expect(isCipherEnvelope({ nope: true })).toBe(false);
  });
});

describe("crypto SBF1 (single-shot bytes)", () => {
  it("round-trips an empty payload", async () => {
    const blob = await encryptBytes("pw", new Uint8Array(0));
    expect(blob.length).toBe(SBF1_HEADER_SIZE + GCM_TAG_SIZE);
    const decrypted = await decryptBytes("pw", blob);
    expect(decrypted.byteLength).toBe(0);
  });

  it("round-trips small payloads", async () => {
    for (const size of [1, 16, 1024, 4096]) {
      const plaintext = randomPlaintext(size);
      const blob = await encryptBytes("pw", plaintext);
      const decrypted = await decryptBytes("pw", blob);
      expect(decrypted).toEqual(plaintext);
    }
  });

  it("fails with a wrong passphrase", async () => {
    const blob = await encryptBytes("right", randomPlaintext(64));
    await expect(decryptBytes("wrong", blob)).rejects.toThrow();
  });

  it("fails on tampered ciphertext", async () => {
    const blob = await encryptBytes("pw", randomPlaintext(64));
    blob[blob.length - 1] ^= 0x01;
    await expect(decryptBytes("pw", blob)).rejects.toThrow();
  });

  it("rejects non-SBF1 inputs", async () => {
    const garbage = new Uint8Array(SBF1_HEADER_SIZE + GCM_TAG_SIZE);
    await expect(decryptBytes("pw", garbage)).rejects.toThrow(/SBF1/);
  });

  it("is detectable via isEncryptedFileBlob", async () => {
    const blob = await encryptBytes("pw", randomPlaintext(16));
    expect(isEncryptedFileBlob(blob)).toBe(true);
    expect(readEncryptedFileFormat(blob)).toBe("SBF1");
  });
});

describe("crypto SBF2 (chunked stream)", () => {
  const chunkSize = 64;

  it("round-trips at exact chunk-size boundaries", async () => {
    for (const size of [chunkSize - 1, chunkSize, chunkSize + 1, chunkSize * 3, chunkSize * 5 + 13]) {
      const plaintext = randomPlaintext(size);
      const { header, chunks } = await streamEncrypt("pw", plaintext, chunkSize);
      expect(header.length).toBe(SBF2_HEADER_SIZE);
      const decrypted = await streamDecrypt("pw", header, chunks);
      expect(decrypted).toEqual(plaintext);
    }
  });

  it("uses a 45-byte header that is detected as SBF2", async () => {
    const plaintext = randomPlaintext(chunkSize + 5);
    const { header } = await streamEncrypt("pw", plaintext, chunkSize);
    expect(header.length).toBe(SBF2_HEADER_SIZE);
    expect(isEncryptedFileBlob(header)).toBe(true);
    expect(readEncryptedFileFormat(header)).toBe("SBF2");
  });

  it("fails with a wrong passphrase on the first chunk", async () => {
    const plaintext = randomPlaintext(chunkSize * 2);
    const { header, chunks } = await streamEncrypt("right", plaintext, chunkSize);
    const decryptor = new FileStreamDecryptor("wrong");
    decryptor.consumeHeader(header);
    await expect(decryptor.decryptChunk(chunks[0], false)).rejects.toThrow();
  });

  it("fails on per-chunk tampering", async () => {
    const plaintext = randomPlaintext(chunkSize * 3);
    const { header, chunks } = await streamEncrypt("pw", plaintext, chunkSize);
    chunks[1][0] ^= 0x42;
    const decryptor = new FileStreamDecryptor("pw");
    decryptor.consumeHeader(header);
    await decryptor.decryptChunk(chunks[0], false);
    await expect(decryptor.decryptChunk(chunks[1], false)).rejects.toThrow();
  });

  it("fails when chunks are reordered", async () => {
    const plaintext = randomPlaintext(chunkSize * 3);
    const { header, chunks } = await streamEncrypt("pw", plaintext, chunkSize);
    const decryptor = new FileStreamDecryptor("pw");
    decryptor.consumeHeader(header);
    await decryptor.decryptChunk(chunks[0], false);
    await expect(decryptor.decryptChunk(chunks[2], false)).rejects.toThrow();
  });

  it("fails when the final chunk is dropped (truncation)", async () => {
    const plaintext = randomPlaintext(chunkSize * 3);
    const { header, chunks } = await streamEncrypt("pw", plaintext, chunkSize);
    const decryptor = new FileStreamDecryptor("pw");
    decryptor.consumeHeader(header);
    await decryptor.decryptChunk(chunks[0], false);
    await decryptor.decryptChunk(chunks[1], false);
    await expect(decryptor.decryptChunk(chunks[1], true)).rejects.toThrow();
  });

  it("fails when a non-final chunk is treated as final", async () => {
    const plaintext = randomPlaintext(chunkSize * 2 + 5);
    const { header, chunks } = await streamEncrypt("pw", plaintext, chunkSize);
    const decryptor = new FileStreamDecryptor("pw");
    decryptor.consumeHeader(header);
    await expect(decryptor.decryptChunk(chunks[0], true)).rejects.toThrow();
  });

  it("rejects bytes that overflow the declared totalSize", async () => {
    const encryptor = new FileStreamEncryptor("pw", 16, 8);
    encryptor.initHeader();
    await encryptor.encryptChunk(randomPlaintext(8), false);
    await expect(encryptor.encryptChunk(randomPlaintext(9), true)).rejects.toThrow();
  });

  it("rejects extra encryptChunk calls after the final chunk", async () => {
    const encryptor = new FileStreamEncryptor("pw", 8, 8);
    encryptor.initHeader();
    await encryptor.encryptChunk(randomPlaintext(8), true);
    await expect(encryptor.encryptChunk(new Uint8Array(0), true)).rejects.toThrow();
  });

  it("can encrypt large totals chunk-by-chunk without buffering the full plaintext", async () => {
    const totalSize = 1 * 1024 * 1024;
    const chunk = 64 * 1024;
    const encryptor = new FileStreamEncryptor("pw", totalSize, chunk);
    const header = encryptor.initHeader();
    const decryptor = new FileStreamDecryptor("pw");
    decryptor.consumeHeader(header);

    let offset = 0;
    let roundTripped = 0;
    while (offset < totalSize) {
      const end = Math.min(offset + chunk, totalSize);
      const isLast = end === totalSize;
      const block = new Uint8Array(end - offset);
      for (let i = 0; i < block.length; i += 1) {
        block[i] = ((offset + i) * 13 + 5) & 0xff;
      }
      const ct = await encryptor.encryptChunk(block, isLast);
      const pt = await decryptor.decryptChunk(ct, isLast);
      for (let i = 0; i < pt.length; i += 1) {
        if (pt[i] !== (((offset + i) * 13 + 5) & 0xff)) {
          throw new Error(`mismatch at ${offset + i}`);
        }
      }
      roundTripped += pt.byteLength;
      offset = end;
    }
    expect(roundTripped).toBe(totalSize);
  });

  it("exposes a sane default chunk size", () => {
    expect(DEFAULT_FILE_CHUNK_SIZE_BYTES).toBe(8 * 1024 * 1024);
  });
});
