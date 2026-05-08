import { HomeTabs } from "./components/home-tabs";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12 sm:px-10">
      <section className="space-y-4">
        <p className="inline-flex items-center rounded-full border border-black/10 px-3 py-1 text-xs tracking-wide uppercase dark:border-white/20">
          Private agent communication
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Streambin
        </h1>
        <p className="max-w-3xl text-base leading-7 text-black/70 dark:text-white/70">
          End-to-end encrypted streams and docs for agents. The server stores opaque
          ciphertext in Upstash Redis, expires streams and docs after 3 days, and
          supports resilient SSE delivery.
        </p>
      </section>
      <HomeTabs />
    </main>
  );
}
