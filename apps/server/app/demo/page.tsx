"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSendToStream, useStream } from "@streambin/react-sdk";
import { FileTester } from "../components/file-tester";

const DEFAULT_NAMESPACE = "test-namespace";
const DEFAULT_PATH = "test/stream";
const DEFAULT_FILE_PATH = "test/upload.bin";
const DEFAULT_PASSPHRASE = "demo-passphrase";

function nowLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

const PROD_BASE_URL = "https://streambin.xyz";

export default function DemoPage() {
  const [namespace, setNamespace] = useState(DEFAULT_NAMESPACE);
  const [path, setPath] = useState(DEFAULT_PATH);
  const [filePath, setFilePath] = useState(DEFAULT_FILE_PATH);
  const [passphrase, setPassphrase] = useState(DEFAULT_PASSPHRASE);
  const [baseUrl, setBaseUrl] = useState(PROD_BASE_URL);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Idle");
  const [sending, setSending] = useState(false);
  const bucket = useMemo(
    () => ({
      baseUrl,
      namespace: namespace.trim() || DEFAULT_NAMESPACE,
      passphrase: passphrase.trim() || DEFAULT_PASSPHRASE,
    }),
    [baseUrl, namespace, passphrase],
  );

  const streamPath = path.trim() || DEFAULT_PATH;
  const resolvedFilePath = filePath.trim() || DEFAULT_FILE_PATH;
  const { messages, connected } = useStream(bucket, streamPath, { mode: "message" });
  const { sendMessage } = useSendToStream(bucket, streamPath);

  useEffect(() => {
    const url = new URL(window.location.href);
    const ns = url.searchParams.get("namespace");
    const p = url.searchParams.get("path");
    const fp = url.searchParams.get("filePath");
    const pass = url.searchParams.get("passphrase");
    const explicitBaseUrl = url.searchParams.get("baseUrl");
    if (ns) setNamespace(ns);
    if (p) setPath(p);
    if (fp) setFilePath(fp);
    if (pass) setPassphrase(pass);
    if (explicitBaseUrl) {
      setBaseUrl(explicitBaseUrl);
    } else if (window.location.hostname !== "streambin.xyz") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("namespace", namespace.trim() || DEFAULT_NAMESPACE);
    url.searchParams.set("path", path.trim() || DEFAULT_PATH);
    url.searchParams.set("filePath", filePath.trim() || DEFAULT_FILE_PATH);
    url.searchParams.set("passphrase", passphrase.trim() || DEFAULT_PASSPHRASE);
    window.history.replaceState({}, "", url.toString());
  }, [namespace, path, filePath, passphrase]);

  useEffect(() => {
    setStatus(connected ? "Connected" : "Disconnected (retrying...)");
  }, [connected]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const value = message.trim();
    if (!value) return;

    setSending(true);
    try {
      await sendMessage(value);
      setMessage("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12 sm:px-10">
      <section className="space-y-3">
        <p className="inline-flex items-center rounded-full border border-black/10 px-3 py-1 text-xs tracking-wide uppercase dark:border-white/20">
          Live demo
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Stream Playground</h1>
        <p className="max-w-3xl text-base leading-7 text-black/70 dark:text-white/70">
          Test real stream delivery end-to-end. Open two tabs with the same namespace/path, send
          from one tab, and watch events appear in both.
        </p>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-black/70">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Namespace</span>
            <input
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/40"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder={DEFAULT_NAMESPACE}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium">Path</span>
            <input
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/40"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={DEFAULT_PATH}
            />
          </label>
          <label className="space-y-2 text-sm md:col-span-2">
            <span className="font-medium">Passphrase</span>
            <input
              className="w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/40"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={DEFAULT_PASSPHRASE}
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-md border border-black/10 bg-black/5 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
          <span>
            Status:{" "}
            <strong className={connected ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
              {status}
            </strong>
          </span>
          <span className="text-xs opacity-80">{bucket.namespace}/{streamPath}</span>
        </div>
        <div className="mt-2 text-xs opacity-70">
          This demo uses <code>@streambin/react-sdk</code>. Only messages decryptable with the current passphrase are shown.
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-black/70">
        <form onSubmit={send} className="flex flex-col gap-3 sm:flex-row">
          <input
            className="flex-1 rounded-md border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black/40"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message and press send"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-black/70">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Received Events</h2>
        </div>

        {messages.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No events yet. Send one from this tab or another tab using the same namespace/path and passphrase.
          </p>
        ) : (
          <div className="max-h-[460px] space-y-2 overflow-auto">
            {[...messages].reverse().slice(0, 100).map((evt) => (
              <article key={evt.id} className="rounded-md border border-black/10 bg-black/5 p-3 text-sm dark:border-white/10 dark:bg-white/5">
                <div className="mb-1 flex items-center justify-between text-xs opacity-70">
                  <span>{nowLabel(evt.timestamp)}</span>
                  <code>{evt.id}</code>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">{String(evt.decoded.value)}</pre>
              </article>
            ))}
          </div>
        )}
      </section>

      <FileTester
        bucket={bucket}
        filePath={resolvedFilePath}
        onFilePathChange={setFilePath}
      />
    </main>
  );
}
