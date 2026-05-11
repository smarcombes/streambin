declare const SBF1_HEADER_SIZE = 37;
declare const SBF2_HEADER_SIZE = 45;
declare const GCM_TAG_SIZE = 16;
declare const DEFAULT_FILE_CHUNK_SIZE_BYTES: number;
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
type EncryptedFileFormat = "SBF1" | "SBF2";
declare function readEncryptedFileFormat(bytes: Uint8Array): EncryptedFileFormat | null;
declare function isEncryptedFileBlob(bytes: Uint8Array): boolean;
declare function encryptBytes(passphrase: string, plaintext: Uint8Array): Promise<Uint8Array>;
declare function decryptBytes(passphrase: string, blob: Uint8Array): Promise<Uint8Array>;
declare class FileStreamEncryptor {
    readonly chunkSize: number;
    readonly totalSize: number;
    private readonly passphrase;
    private readonly iterations;
    private readonly salt;
    private readonly baseNonce;
    private key;
    private counter;
    private bytesAccepted;
    private headerEmitted;
    private finalEmitted;
    constructor(passphrase: string, totalSize: number, chunkSize?: number);
    initHeader(): Uint8Array;
    encryptChunk(plaintext: Uint8Array, isLast: boolean): Promise<Uint8Array>;
    private ensureKey;
}
type ConsumedStreamHeader = {
    chunkSize: number;
    totalSize: number;
    headerSize: number;
    iterations: number;
};
declare class FileStreamDecryptor {
    private readonly passphrase;
    private chunkSize;
    private totalSize;
    private iterations;
    private salt;
    private baseNonce;
    private key;
    private counter;
    private bytesDecrypted;
    private headerConsumed;
    private finalConsumed;
    constructor(passphrase: string);
    consumeHeader(bytes: Uint8Array): ConsumedStreamHeader;
    decryptChunk(ciphertext: Uint8Array, isLast: boolean): Promise<Uint8Array>;
    private ensureKey;
}

export { type CipherEnvelope, type CipherEnvelopeV1, type ConsumedStreamHeader, DEFAULT_FILE_CHUNK_SIZE_BYTES, type EncryptedFileFormat, FileStreamDecryptor, FileStreamEncryptor, GCM_TAG_SIZE, SBF1_HEADER_SIZE, SBF2_HEADER_SIZE, decryptBytes, decryptJson, decryptString, deterministicObjectChannel, encryptBytes, encryptJson, encryptString, isCipherEnvelope, isEncryptedFileBlob, readEncryptedFileFormat };
