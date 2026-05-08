import { StreambinClient, StreambinClientOptions, ListenMode, StreamMessage } from '@streambin/sdk';

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
declare const useStreamboxClient: typeof useStreambinClient;
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

export { type StreamSource, type StreambinBucket, useObject, useObjectActions, useSendToStream, useStream, useStreambinClient, useStreamboxClient };
