// src/index.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StreambinClient
} from "@streambin/sdk";
var DEFAULT_BASE_URL = "https://streambin.xyz";
function useResolvedClient(source) {
  const isClient = source instanceof StreambinClient;
  const existingClient = isClient ? source : void 0;
  const baseUrl = isClient ? void 0 : source.baseUrl;
  const namespace = isClient ? void 0 : source.namespace;
  const passphrase = isClient ? void 0 : source.passphrase;
  return useMemo(() => {
    if (isClient) {
      return existingClient;
    }
    if (!namespace || !passphrase) {
      throw new Error("namespace and passphrase are required");
    }
    return new StreambinClient({
      baseUrl: (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      namespace,
      passphrase
    });
  }, [isClient, existingClient, baseUrl, namespace, passphrase]);
}
function useStreambinClient(options) {
  return useResolvedClient(options);
}
function useSendToStream(source, path) {
  const client = useResolvedClient(source);
  const sendMessage = useCallback(
    (message) => client.appendMessage(path, message),
    [client, path]
  );
  const sendJson = useCallback(
    (value) => client.appendJson(path, value),
    [client, path]
  );
  return { sendMessage, sendJson };
}
function useStream(source, path, options) {
  const client = useResolvedClient(source);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const lastCursor = useRef(options?.after ?? 0);
  useEffect(() => {
    let mounted = true;
    setMessages([]);
    client.getStream(path, {
      after: options?.after,
      mode: options?.mode
    }).then((initial) => {
      if (!mounted) {
        return;
      }
      setMessages(initial);
      const newest = initial.at(-1);
      if (newest) {
        lastCursor.current = newest.timestamp;
      }
    }).catch(() => {
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
        onStatus: setConnected
      }
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [client, path, options?.after, options?.mode]);
  return {
    messages,
    connected
  };
}
function useObject(source, path) {
  const resolvedClient = useResolvedClient(source);
  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    resolvedClient.getObject(path).then((current) => {
      if (!mounted) {
        return;
      }
      setValue(current);
    }).finally(() => {
      if (mounted) {
        setLoading(false);
      }
    });
    const unsubscribe = resolvedClient.listenObject(path, (next) => {
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
function useObjectActions(source, path) {
  const client = useResolvedClient(source);
  const set = useCallback((value) => client.setObject(path, value), [client, path]);
  const update = useCallback(
    (updater) => client.updateObject(path, updater),
    [client, path]
  );
  const remove = useCallback(() => client.removeObject(path), [client, path]);
  return { set, update, remove };
}
function useFileUpload(source, path) {
  const client = useResolvedClient(source);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const uploadFile = useCallback(
    async (file, options) => {
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
    [client, path]
  );
  const getFileUrl = useCallback(() => client.getFileUrl(path), [client, path]);
  const removeFile = useCallback(() => client.deleteFile(path), [client, path]);
  return { uploadFile, getFileUrl, removeFile, uploading, error };
}
function useFileDownload(source, path, options) {
  const client = useResolvedClient(source);
  const enabled = options?.enabled !== false;
  const [bytes, setBytes] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [contentType, setContentType] = useState(null);
  const [encrypted, setEncrypted] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const blobUrlRef = useRef(null);
  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const downloaded = await client.downloadFile(path);
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
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
        const buffer = downloaded.bytes.byteOffset === 0 && downloaded.bytes.byteLength === downloaded.bytes.buffer.byteLength ? downloaded.bytes.buffer : downloaded.bytes.slice().buffer;
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
    });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
        }
        blobUrlRef.current = null;
      }
      void cancelled;
    };
  }, [enabled, fetchOnce]);
  return { bytes, blobUrl, contentType, encrypted, metadata, loading, error, refetch: fetchOnce };
}
export {
  useFileDownload,
  useFileUpload,
  useObject,
  useObjectActions,
  useSendToStream,
  useStream,
  useStreambinClient
};
