import { StreamEventEnvelope } from '@streambin/shared';

type DecodedPayload = {
    type: "message";
    value: string;
} | {
    type: "json";
    value: unknown;
};
type StreamMessage = StreamEventEnvelope & {
    decoded: DecodedPayload;
};
type StreamValue = DecodedPayload["value"];
type ObjectPatch = Record<string, unknown>;
type ListenMode = "message" | "json" | "both";
type UploadableFileStream = {
    size: number;
    stream: () => ReadableStream<Uint8Array>;
    contentType?: string;
};
type UploadableFile = Blob | ArrayBuffer | Uint8Array | UploadableFileStream;
type UploadFileOptions = {
    contentType?: string;
    encrypted?: boolean;
    chunkSize?: number;
    multipart?: {
        enabled?: boolean;
        partSize?: number;
    };
};
type UploadedFile = {
    fileId: string;
    key: string;
    publicUrl: string;
    contentType: string;
    originalContentType: string;
    encrypted: boolean;
    size: number;
    updatedAt: number;
};
type FileMetadata = {
    fileId: string;
    key: string;
    publicUrl: string;
    contentType: string;
    originalContentType: string;
    encrypted: boolean;
    size: number;
    updatedAt: number;
};
type DownloadedFile = {
    bytes: Uint8Array;
    contentType: string;
    encrypted: boolean;
    metadata: FileMetadata;
};
type DownloadedFileStream = {
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    encrypted: boolean;
    metadata: FileMetadata;
};
type StreambinClientOptions = {
    baseUrl: string;
    namespace: string;
    passphrase: string;
    fetchImpl?: typeof fetch;
};
type ListenOptions = {
    after?: number;
    mode?: ListenMode;
    heartbeatTimeoutMs?: number;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    onStatus?: (connected: boolean) => void;
};
declare class StreambinClient {
    private readonly baseUrl;
    private readonly namespace;
    private readonly passphrase;
    private readonly fetchImpl;
    constructor(options: StreambinClientOptions);
    private streamUrl;
    private docUrl;
    private fileUrl;
    private normalize;
    appendMessage(path: string, message: string): Promise<StreamEventEnvelope>;
    appendJson(path: string, value: unknown): Promise<StreamEventEnvelope>;
    getStream(path: string, options?: {
        after?: number;
        limit?: number;
        mode?: ListenMode;
    }): Promise<StreamMessage[]>;
    listenStreamEvents(path: string, onMessage: (message: StreamMessage) => void, options?: ListenOptions): () => void;
    listenStream(path: string, onMessage: (value: StreamValue) => void, options?: ListenOptions): () => void;
    setObject(path: string, value: unknown): Promise<void>;
    getObject<T>(path: string): Promise<T | null>;
    updateObject<T>(path: string, updaterOrPatch: ((current: T | null) => T) | ObjectPatch): Promise<T>;
    removeObject(path: string): Promise<void>;
    uploadFile(path: string, file: UploadableFile, options?: UploadFileOptions): Promise<UploadedFile>;
    private uploadFilePlaintext;
    private uploadFileEncryptedSingle;
    private uploadFileEncryptedMultipart;
    private completeUpload;
    getFileUrl(path: string): string;
    getFileMetadata(path: string): Promise<FileMetadata | null>;
    downloadFile(path: string): Promise<DownloadedFile | null>;
    downloadFileStream(path: string): Promise<DownloadedFileStream | null>;
    getDecryptedBlobUrl(path: string): Promise<string | null>;
    deleteFile(path: string): Promise<void>;
    listenObject<T>(path: string, onValue: (value: T | null) => void, options?: Omit<ListenOptions, "mode">): () => void;
    hasObjectChangedSince(path: string, timestamp: number): Promise<boolean>;
}
declare const StreamboxClient: typeof StreambinClient;
type StreamboxClientOptions = StreambinClientOptions;

export { type DecodedPayload, type DownloadedFile, type DownloadedFileStream, type FileMetadata, type ListenMode, type ListenOptions, type ObjectPatch, type StreamMessage, type StreamValue, StreambinClient, type StreambinClientOptions, StreamboxClient, type StreamboxClientOptions, type UploadFileOptions, type UploadableFile, type UploadableFileStream, type UploadedFile };
