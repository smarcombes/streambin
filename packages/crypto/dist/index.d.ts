type CipherEnvelopeV1 = {
    v: 1;
    alg: "AES-GCM";
    kdf: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
};
type CipherEnvelope = CipherEnvelopeV1;
declare function encryptString(passphrase: string, plaintext: string): Promise<CipherEnvelope>;
declare function decryptString(passphrase: string, envelope: CipherEnvelope): Promise<string>;
declare function encryptJson<T>(passphrase: string, value: T): Promise<CipherEnvelope>;
declare function decryptJson<T>(passphrase: string, envelope: CipherEnvelope): Promise<T>;
declare function isCipherEnvelope(value: unknown): value is CipherEnvelope;
declare function deterministicObjectChannel(path: string): string;

export { type CipherEnvelope, type CipherEnvelopeV1, decryptJson, decryptString, deterministicObjectChannel, encryptJson, encryptString, isCipherEnvelope };
