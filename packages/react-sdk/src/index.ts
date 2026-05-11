import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadedFile,
  FileMetadata,
  ListenMode,
  StreamMessage,
  StreambinClient,
  StreambinClientOptions,
  UploadFileOptions,
  UploadableFile,
  UploadedFile,
} from "@streambin/sdk";

const DEFAULT_BASE_URL = "https://streambin.xyz";

export type StreambinBucket = Omit<StreambinClientOptions, "baseUrl"> & {
  baseUrl?: string;
};

export type StreamSource = StreambinClient | StreambinBucket;

function useResolvedClient(source: StreamSource): StreambinClient {
  const isClient = source instanceof StreambinClient;
  const existingClient = isClient ? source : undefined;
  const baseUrl = isClient ? undefined : source.baseUrl;
  const namespace = isClient ? undefined : source.namespace;
  const passphrase = isClient ? undefined : source.passphrase;

  return useMemo(() => {
    if (isClient) {
      return existingClient as StreambinClient;
    }

    if (!namespace || !passphrase) {
      throw new Error("namespace and passphrase are required");
    }

    return new StreambinClient({
      baseUrl: (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      namespace,
      passphrase,
    });
  }, [isClient, existingClient, baseUrl, namespace, passphrase]);
}

export function useStreambinClient(options: StreambinBucket): StreambinClient {
  return useResolvedClient(options);
}

export function useSendToStream(source: StreamSource, path: string) {
  const client = useResolvedClient(source);
  const sendMessage = useCallback(
    (message: string) => client.appendMessage(path, message),
    [client, path],
  );

  const sendJson = useCallback(
    (value: unknown) => client.appendJson(path, value),
    [client, path],
  );

  return { sendMessage, sendJson };
}

export function useStream(
  source: StreamSource,
  path: string,
  options?: { mode?: ListenMode; after?: number },
) {
  const client = useResolvedClient(source);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const lastCursor = useRef(options?.after ?? 0);

  useEffect(() => {
    let mounted = true;
    setMessages([]);

    client
      .getStream(path, {
        after: options?.after,
        mode: options?.mode,
      })
      .then((initial) => {
        if (!mounted) {
          return;
        }
        setMessages(initial);
        const newest = initial.at(-1);
        if (newest) {
          lastCursor.current = newest.timestamp;
        }
      })
      .catch(() => {
        // ignore bootstrap fetch failures and rely on live stream reconnection
      });

    const unsubscribe = client.listenStreamEvents(
      path,
      (event) => {
        if (!mounted) {
          return;
        }

        lastCursor.current = Math.max(lastCursor.current, event.timestamp);
        setMessages((prev) => [...prev, event]);
      },
      {
        mode: options?.mode,
        after: lastCursor.current,
        onStatus: setConnected,
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [client, path, options?.after, options?.mode]);

  return {
    messages,
    connected,
  };
}

export function useObject<T>(source: StreamSource, path: string) {
  const resolvedClient = useResolvedClient(source);
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    resolvedClient
      .getObject<T>(path)
      .then((current) => {
        if (!mounted) {
          return;
        }
        setValue(current);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    const unsubscribe = resolvedClient.listenObject<T>(path, (next) => {
      if (mounted) {
        setValue(next);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [resolvedClient, path]);

  return { value, loading };
}

export function useObjectActions<T>(source: StreamSource, path: string) {
  const client = useResolvedClient(source);
  const set = useCallback((value: T) => client.setObject(path, value), [client, path]);
  const update = useCallback(
    (updater: (current: T | null) => T) => client.updateObject(path, updater),
    [client, path],
  );
  const remove = useCallback(() => client.removeObject(path), [client, path]);

  return { set, update, remove };
}

export function useFileUpload(source: StreamSource, path: string) {
  const client = useResolvedClient(source);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const uploadFile = useCallback(
    async (file: UploadableFile, options?: UploadFileOptions): Promise<UploadedFile> => {
      setUploading(true);
      setError(null);
      try {
        return await client.uploadFile(path, file, options);
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error("File upload failed");
        setError(wrapped);
        throw wrapped;
      } finally {
        setUploading(false);
      }
    },
    [client, path],
  );

  const getFileUrl = useCallback(() => client.getFileUrl(path), [client, path]);
  const removeFile = useCallback(() => client.deleteFile(path), [client, path]);

  return { uploadFile, getFileUrl, removeFile, uploading, error };
}

export type UseFileDownloadResult = {
  bytes: Uint8Array | null;
  blobUrl: string | null;
  contentType: string | null;
  encrypted: boolean | null;
  metadata: FileMetadata | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export type UseFileDownloadOptions = {
  enabled?: boolean;
};

export function useFileDownload(
  source: StreamSource,
  path: string,
  options?: UseFileDownloadOptions,
): UseFileDownloadResult {
  const client = useResolvedClient(source);
  const enabled = options?.enabled !== false;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState<boolean | null>(null);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const blobUrlRef = useRef<string | null>(null);

  const fetchOnce = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const downloaded: DownloadedFile | null = await client.downloadFile(path);

      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
          // ignore
        }
        blobUrlRef.current = null;
      }

      if (!downloaded) {
        setBytes(null);
        setBlobUrl(null);
        setContentType(null);
        setEncrypted(null);
        setMetadata(null);
        return;
      }

      setBytes(downloaded.bytes);
      setContentType(downloaded.contentType);
      setEncrypted(downloaded.encrypted);
      setMetadata(downloaded.metadata);

      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob !== "undefined") {
        const buffer = downloaded.bytes.byteOffset === 0 && downloaded.bytes.byteLength === downloaded.bytes.buffer.byteLength
          ? (downloaded.bytes.buffer as ArrayBuffer)
          : (downloaded.bytes.slice().buffer as ArrayBuffer);
        const blob = new Blob([buffer], { type: downloaded.contentType });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      } else {
        setBlobUrl(null);
      }
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error("File download failed");
      setError(wrapped);
    } finally {
      setLoading(false);
    }
  }, [client, path]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void fetchOnce().catch(() => {
      // already captured in state
    });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
          // ignore
        }
        blobUrlRef.current = null;
      }
      void cancelled;
    };
  }, [enabled, fetchOnce]);

  return { bytes, blobUrl, contentType, encrypted, metadata, loading, error, refetch: fetchOnce };
}
