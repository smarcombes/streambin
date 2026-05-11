// src/index.ts
import { fnv1aHash } from "@streambin/shared";
var VERSION = 1;
var KEY_USAGES = ["encrypt", "decrypt"];
var ITERATIONS = 31e4;
var SALT_BYTES = 16;
var IV_BYTES = 12;
var SBF1_MAGIC = "SBF1";
var SBF2_MAGIC = "SBF2";
var SBF1_MAGIC_BYTES = new TextEncoder().encode(SBF1_MAGIC);
var SBF2_MAGIC_BYTES = new TextEncoder().encode(SBF2_MAGIC);
var BASE_NONCE_BYTES = 8;
var SBF1_HEADER_SIZE = 37;
var SBF2_HEADER_SIZE = 45;
var GCM_TAG_SIZE = 16;
var DEFAULT_FILE_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
var MAX_STREAM_COUNTER = 16777215;
function getWebCrypto() {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API not available in this runtime");
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function toBytes(input) {
  return new TextEncoder().encode(input);
}
function asBufferSource(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function fromBytes(input) {
  return new TextDecoder().decode(input);
}
function randomBytes(length) {
  const crypto = getWebCrypto();
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
function bytesStartWith(bytes, prefix) {
  if (bytes.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}
function writeUint32BE(out, offset, value) {
  out[offset] = value >>> 24 & 255;
  out[offset + 1] = value >>> 16 & 255;
  out[offset + 2] = value >>> 8 & 255;
  out[offset + 3] = value & 255;
}
function readUint32BE(bytes, offset) {
  return bytes[offset] * 16777216 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}
function writeUint64BE(out, offset, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("uint64 value must be non-negative");
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error("uint64 value exceeds Number.MAX_SAFE_INTEGER");
  }
  const high = Math.floor(value / 4294967296);
  const low = value >>> 0;
  writeUint32BE(out, offset, high);
  writeUint32BE(out, offset + 4, low);
}
function readUint64BENumber(bytes, offset) {
  const high = readUint32BE(bytes, offset);
  const low = readUint32BE(bytes, offset + 4);
  return high * 4294967296 + low;
}
function buildStreamIv(baseNonce, counter, isLast) {
  if (counter < 0 || counter > MAX_STREAM_COUNTER) {
    throw new Error(`Stream counter out of range: ${counter}`);
  }
  const iv = new Uint8Array(IV_BYTES);
  iv.set(baseNonce, 0);
  iv[8] = counter >>> 16 & 255;
  iv[9] = counter >>> 8 & 255;
  iv[10] = counter & 255;
  iv[11] = isLast ? 1 : 0;
  return iv;
}
async function deriveAesKey(passphrase, salt, iterations) {
  const crypto = getWebCrypto();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    asBufferSource(toBytes(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    KEY_USAGES
  );
}
async function encryptString(passphrase, plaintext) {
  const crypto = getWebCrypto();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv)
    },
    key,
    asBufferSource(toBytes(plaintext))
  );
  return {
    v: VERSION,
    alg: "AES-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext))
  };
}
async function decryptString(passphrase, envelope) {
  if (envelope.v !== VERSION) {
    throw new Error(`Unsupported cipher envelope version: ${envelope.v}`);
  }
  const crypto = getWebCrypto();
  const salt = base64UrlToBytes(envelope.salt);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv)
    },
    key,
    asBufferSource(ciphertext)
  );
  return fromBytes(plaintext);
}
async function encryptJson(passphrase, value) {
  return encryptString(passphrase, JSON.stringify(value));
}
async function decryptJson(passphrase, envelope) {
  const raw = await decryptString(passphrase, envelope);
  return JSON.parse(raw);
}
function isCipherEnvelope(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return candidate.v === 1 && candidate.alg === "AES-GCM" && candidate.kdf === "PBKDF2" && typeof candidate.hash === "string" && typeof candidate.iterations === "number" && typeof candidate.salt === "string" && typeof candidate.iv === "string" && typeof candidate.ciphertext === "string";
}
function deterministicObjectChannel(path) {
  return `_docs/${fnv1aHash(path)}-${path.replaceAll("/", "_")}`;
}
function readEncryptedFileFormat(bytes) {
  if (bytesStartWith(bytes, SBF1_MAGIC_BYTES)) {
    return "SBF1";
  }
  if (bytesStartWith(bytes, SBF2_MAGIC_BYTES)) {
    return "SBF2";
  }
  return null;
}
function isEncryptedFileBlob(bytes) {
  return readEncryptedFileFormat(bytes) !== null;
}
async function encryptBytes(passphrase, plaintext) {
  const cryptoApi = getWebCrypto();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt, ITERATIONS);
  const ciphertext = new Uint8Array(
    await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      key,
      asBufferSource(plaintext)
    )
  );
  const out = new Uint8Array(SBF1_HEADER_SIZE + ciphertext.byteLength);
  out.set(SBF1_MAGIC_BYTES, 0);
  out[4] = 1;
  writeUint32BE(out, 5, ITERATIONS);
  out.set(salt, 9);
  out.set(iv, 25);
  out.set(ciphertext, SBF1_HEADER_SIZE);
  return out;
}
async function decryptBytes(passphrase, blob) {
  if (!bytesStartWith(blob, SBF1_MAGIC_BYTES)) {
    throw new Error("Not an SBF1 encrypted blob");
  }
  if (blob.length < SBF1_HEADER_SIZE + GCM_TAG_SIZE) {
    throw new Error("SBF1 blob too short");
  }
  if (blob[4] !== 1) {
    throw new Error(`Unsupported SBF1 version: ${blob[4]}`);
  }
  const iterations = readUint32BE(blob, 5);
  const salt = blob.subarray(9, 25);
  const iv = blob.subarray(25, 37);
  const ciphertext = blob.subarray(SBF1_HEADER_SIZE);
  const key = await deriveAesKey(passphrase, salt, iterations);
  const cryptoApi = getWebCrypto();
  const plaintext = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext)
  );
  return new Uint8Array(plaintext);
}
var FileStreamEncryptor = class {
  chunkSize;
  totalSize;
  passphrase;
  iterations;
  salt;
  baseNonce;
  key = null;
  counter = 0;
  bytesAccepted = 0;
  headerEmitted = false;
  finalEmitted = false;
  constructor(passphrase, totalSize, chunkSize) {
    if (!Number.isFinite(totalSize) || totalSize < 0) {
      throw new Error("totalSize must be a non-negative number");
    }
    if (chunkSize !== void 0 && (!Number.isFinite(chunkSize) || chunkSize <= 0)) {
      throw new Error("chunkSize must be a positive number");
    }
    this.passphrase = passphrase;
    this.totalSize = totalSize;
    this.chunkSize = chunkSize ?? DEFAULT_FILE_CHUNK_SIZE_BYTES;
    this.iterations = ITERATIONS;
    this.salt = randomBytes(SALT_BYTES);
    this.baseNonce = randomBytes(BASE_NONCE_BYTES);
  }
  initHeader() {
    if (this.headerEmitted) {
      throw new Error("Header already emitted");
    }
    const header = new Uint8Array(SBF2_HEADER_SIZE);
    header.set(SBF2_MAGIC_BYTES, 0);
    header[4] = 2;
    writeUint32BE(header, 5, this.iterations);
    header.set(this.salt, 9);
    header.set(this.baseNonce, 25);
    writeUint32BE(header, 33, this.chunkSize);
    writeUint64BE(header, 37, this.totalSize);
    this.headerEmitted = true;
    return header;
  }
  async encryptChunk(plaintext, isLast) {
    if (!this.headerEmitted) {
      throw new Error("Must call initHeader() before encryptChunk()");
    }
    if (this.finalEmitted) {
      throw new Error("Final chunk already emitted");
    }
    if (!isLast && plaintext.byteLength !== this.chunkSize) {
      throw new Error(
        `Non-final chunks must equal chunkSize (got ${plaintext.byteLength}, expected ${this.chunkSize})`
      );
    }
    if (plaintext.byteLength > this.chunkSize) {
      throw new Error(`Chunk too large (got ${plaintext.byteLength}, max ${this.chunkSize})`);
    }
    if (this.bytesAccepted + plaintext.byteLength > this.totalSize) {
      throw new Error("Encrypted bytes exceed declared totalSize");
    }
    const key = await this.ensureKey();
    const iv = buildStreamIv(this.baseNonce, this.counter, isLast);
    const cryptoApi = getWebCrypto();
    const ct = new Uint8Array(
      await cryptoApi.subtle.encrypt(
        { name: "AES-GCM", iv: asBufferSource(iv) },
        key,
        asBufferSource(plaintext)
      )
    );
    this.counter += 1;
    this.bytesAccepted += plaintext.byteLength;
    if (isLast) {
      if (this.bytesAccepted !== this.totalSize) {
        throw new Error(
          `Final chunk emitted but total bytes (${this.bytesAccepted}) != totalSize (${this.totalSize})`
        );
      }
      this.finalEmitted = true;
    }
    return ct;
  }
  async ensureKey() {
    if (!this.key) {
      this.key = await deriveAesKey(this.passphrase, this.salt, this.iterations);
    }
    return this.key;
  }
};
var FileStreamDecryptor = class {
  passphrase;
  chunkSize = 0;
  totalSize = 0;
  iterations = 0;
  salt = null;
  baseNonce = null;
  key = null;
  counter = 0;
  bytesDecrypted = 0;
  headerConsumed = false;
  finalConsumed = false;
  constructor(passphrase) {
    this.passphrase = passphrase;
  }
  consumeHeader(bytes) {
    if (this.headerConsumed) {
      throw new Error("Header already consumed");
    }
    if (bytes.length < SBF2_HEADER_SIZE) {
      throw new Error(`Header too short (need ${SBF2_HEADER_SIZE} bytes, got ${bytes.length})`);
    }
    if (!bytesStartWith(bytes, SBF2_MAGIC_BYTES)) {
      throw new Error("Not an SBF2 encrypted stream");
    }
    if (bytes[4] !== 2) {
      throw new Error(`Unsupported SBF2 version: ${bytes[4]}`);
    }
    this.iterations = readUint32BE(bytes, 5);
    this.salt = bytes.slice(9, 25);
    this.baseNonce = bytes.slice(25, 33);
    this.chunkSize = readUint32BE(bytes, 33);
    this.totalSize = readUint64BENumber(bytes, 37);
    if (this.chunkSize <= 0) {
      throw new Error("Invalid chunkSize in header");
    }
    if (this.totalSize < 0) {
      throw new Error("Invalid totalSize in header");
    }
    this.headerConsumed = true;
    return {
      chunkSize: this.chunkSize,
      totalSize: this.totalSize,
      headerSize: SBF2_HEADER_SIZE,
      iterations: this.iterations
    };
  }
  async decryptChunk(ciphertext, isLast) {
    if (!this.headerConsumed || !this.baseNonce) {
      throw new Error("Must consumeHeader() before decryptChunk()");
    }
    if (this.finalConsumed) {
      throw new Error("Final chunk already consumed");
    }
    const key = await this.ensureKey();
    const iv = buildStreamIv(this.baseNonce, this.counter, isLast);
    const cryptoApi = getWebCrypto();
    const plaintext = new Uint8Array(
      await cryptoApi.subtle.decrypt(
        { name: "AES-GCM", iv: asBufferSource(iv) },
        key,
        asBufferSource(ciphertext)
      )
    );
    if (!isLast && plaintext.byteLength !== this.chunkSize) {
      throw new Error(
        `Non-final decrypted chunk size mismatch (got ${plaintext.byteLength}, expected ${this.chunkSize})`
      );
    }
    this.counter += 1;
    this.bytesDecrypted += plaintext.byteLength;
    if (isLast) {
      if (this.bytesDecrypted !== this.totalSize) {
        throw new Error(
          `Decrypted total (${this.bytesDecrypted}) does not match header totalSize (${this.totalSize})`
        );
      }
      this.finalConsumed = true;
    }
    return plaintext;
  }
  async ensureKey() {
    if (!this.headerConsumed || !this.salt) {
      throw new Error("Must consumeHeader() first");
    }
    if (!this.key) {
      this.key = await deriveAesKey(this.passphrase, this.salt, this.iterations);
    }
    return this.key;
  }
};
export {
  DEFAULT_FILE_CHUNK_SIZE_BYTES,
  FileStreamDecryptor,
  FileStreamEncryptor,
  GCM_TAG_SIZE,
  SBF1_HEADER_SIZE,
  SBF2_HEADER_SIZE,
  decryptBytes,
  decryptJson,
  decryptString,
  deterministicObjectChannel,
  encryptBytes,
  encryptJson,
  encryptString,
  isCipherEnvelope,
  isEncryptedFileBlob,
  readEncryptedFileFormat
};
