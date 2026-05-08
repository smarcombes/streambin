import { describe, expect, it } from "vitest";
import { decryptJson, decryptString, encryptJson, encryptString, isCipherEnvelope } from "./index";

describe("crypto", () => {
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
