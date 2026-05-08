import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ListenMode,
  StreamMessage,
  StreambinClient,
  StreambinClientOptions,
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

// Backward-compatible hook alias.
export const useStreamboxClient = useStreambinClient;

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
