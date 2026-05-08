import { fnv1aHash } from "@streambin/shared";

const VERSION = 1;
const KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];
const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type CipherEnvelopeV1 = {
  v: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type CipherEnvelope = CipherEnvelopeV1;

function getWebCrypto(): Crypto {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }

  throw new Error("Web Crypto API not available in this runtime");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fromBytes(input: ArrayBuffer): string {
  return new TextDecoder().decode(input);
}

function randomBytes(length: number): Uint8Array {
  const crypto = getWebCrypto();
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const crypto = getWebCrypto();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    asBufferSource(toBytes(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    KEY_USAGES,
  );
}

export async function encryptString(passphrase: string, plaintext: string): Promise<CipherEnvelope> {
  const crypto = getWebCrypto();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt, ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv),
    },
    key,
    asBufferSource(toBytes(plaintext)),
  );

  return {
    v: VERSION,
    alg: "AES-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: ITERATIONS,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptString(passphrase: string, envelope: CipherEnvelope): Promise<string> {
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
      iv: asBufferSource(iv),
    },
    key,
    asBufferSource(ciphertext),
  );

  return fromBytes(plaintext);
}

export async function encryptJson<T>(passphrase: string, value: T): Promise<CipherEnvelope> {
  return encryptString(passphrase, JSON.stringify(value));
}

export async function decryptJson<T>(passphrase: string, envelope: CipherEnvelope): Promise<T> {
  const raw = await decryptString(passphrase, envelope);
  return JSON.parse(raw) as T;
}

export function isCipherEnvelope(value: unknown): value is CipherEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CipherEnvelope>;
  return (
    candidate.v === 1 &&
    candidate.alg === "AES-GCM" &&
    candidate.kdf === "PBKDF2" &&
    typeof candidate.hash === "string" &&
    typeof candidate.iterations === "number" &&
    typeof candidate.salt === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

export function deterministicObjectChannel(path: string): string {
  return `_docs/${fnv1aHash(path)}-${path.replaceAll("/", "_")}`;
}
