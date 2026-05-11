import { StreambinClient, StreambinClientOptions, FileMetadata, UploadableFile, UploadFileOptions, UploadedFile, ListenMode, StreamMessage } from '@streambin/sdk';

type StreamEventEnvelope = {
    event: "message";
    id: string;
    timestamp: number;
    string: string;
};

type StreambinBucket = Omit<StreambinClientOptions, "baseUrl"> & {
    baseUrl?: string;
};
type StreamSource = StreambinClient | StreambinBucket;
declare function useStreambinClient(options: StreambinBucket): StreambinClient;
declare function useSendToStream(source: StreamSource, path: string): {
    sendMessage: (message: string) => Promise<StreamEventEnvelope>;
    sendJson: (value: unknown) => Promise<StreamEventEnvelope>;
};
declare function useStream(source: StreamSource, path: string, options?: {
    mode?: ListenMode;
    after?: number;
}): {
    messages: StreamMessage[];
    connected: boolean;
};
declare function useObject<T>(source: StreamSource, path: string): {
    value: T | null;
    loading: boolean;
};
declare function useObjectActions<T>(source: StreamSource, path: string): {
    set: (value: T) => Promise<void>;
    update: (updater: (current: T | null) => T) => Promise<T>;
    remove: () => Promise<void>;
};
declare function useFileUpload(source: StreamSource, path: string): {
    uploadFile: (file: UploadableFile, options?: UploadFileOptions) => Promise<UploadedFile>;
    getFileUrl: () => string;
    removeFile: () => Promise<void>;
    uploading: boolean;
    error: Error | null;
};
type UseFileDownloadResult = {
    bytes: Uint8Array | null;
    blobUrl: string | null;
    contentType: string | null;
    encrypted: boolean | null;
    metadata: FileMetadata | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
type UseFileDownloadOptions = {
    enabled?: boolean;
};
declare function useFileDownload(source: StreamSource, path: string, options?: UseFileDownloadOptions): UseFileDownloadResult;

export { type StreamSource, type StreambinBucket, type UseFileDownloadOptions, type UseFileDownloadResult, useFileDownload, useFileUpload, useObject, useObjectActions, useSendToStream, useStream, useStreambinClient };
