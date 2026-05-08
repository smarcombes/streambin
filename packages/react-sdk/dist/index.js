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
var useStreamboxClient = useStreambinClient;
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
export {
  useObject,
  useObjectActions,
  useSendToStream,
  useStream,
  useStreambinClient,
  useStreamboxClient
};
