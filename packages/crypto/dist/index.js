// src/index.ts
import { fnv1aHash } from "@streambin/shared";
var VERSION = 1;
var KEY_USAGES = ["encrypt", "decrypt"];
var ITERATIONS = 31e4;
var SALT_BYTES = 16;
var IV_BYTES = 12;
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
export {
  decryptJson,
  decryptString,
  deterministicObjectChannel,
  encryptJson,
  encryptString,
  isCipherEnvelope
};
