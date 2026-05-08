#!/usr/bin/env node

// src/index.ts
import { randomBytes, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { Command } from "commander";
import { StreambinClient } from "@streambin/sdk";
var CONFIG_DIR = path.join(homedir(), ".streambin");
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
var STATE_FILE = path.join(CONFIG_DIR, "state.json");
var DEFAULT_BASE_URL = process.env.STREAMBIN_BASE_URL ?? "https://streambin.xyz";
var ADJECTIVES = [
  "frozen",
  "silent",
  "amber",
  "clever",
  "daring",
  "gentle",
  "lunar",
  "velvet",
  "cobalt",
  "steady",
  "rapid",
  "crystal",
  "sunny",
  "brisk",
  "vivid",
  "nimble",
  "mellow",
  "solar",
  "silver",
  "glassy",
  "royal",
  "breezy",
  "stellar",
  "atomic",
  "minted",
  "quiet",
  "bright",
  "dusky",
  "golden",
  "smoky",
  "urban",
  "rustic",
  "sacred",
  "tidal",
  "polar",
  "future",
  "bold",
  "lively",
  "swift",
  "lucky"
];
var ANIMALS = [
  "castor",
  "otter",
  "falcon",
  "lynx",
  "fox",
  "badger",
  "orca",
  "raven",
  "panda",
  "koala",
  "gecko",
  "ibex",
  "wolf",
  "yak",
  "lemur",
  "tiger",
  "heron",
  "beetle",
  "pelican",
  "sparrow",
  "viper",
  "shark",
  "buffalo",
  "whale",
  "jaguar",
  "cougar",
  "wombat",
  "alpaca",
  "toucan",
  "skink",
  "condor",
  "narwhal",
  "marten",
  "coyote",
  "panther",
  "urchin",
  "slug",
  "moose",
  "dolphin",
  "boar"
];
async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}
async function readJsonFile(target, fallback) {
  try {
    const raw = await readFile(target, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonFile(target, value) {
  await ensureConfigDir();
  await writeFile(target, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function readConfig() {
  return readJsonFile(CONFIG_FILE, { buckets: {} });
}
async function readState() {
  return readJsonFile(STATE_FILE, { cursors: {} });
}
async function saveState(state) {
  await writeJsonFile(STATE_FILE, state);
}
function normalizeSlug(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "");
}
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function generateSlug(existing) {
  const adjectives = shuffle(ADJECTIVES);
  const animals = shuffle(ANIMALS);
  for (const adjective of adjectives) {
    for (const animal of animals) {
      const slug = `${adjective}-${animal}`;
      if (!existing.has(slug)) {
        return slug;
      }
    }
  }
  return `bucket-${randomBytes(4).toString("hex")}`;
}
function generatePassphrase() {
  return randomBytes(24).toString("base64url").replace(/[_-]/g, "");
}
function parseBucketImportToken(token) {
  const trimmed = token.trim();
  const payload = trimmed.startsWith("npx ") ? trimmed.slice(trimmed.lastIndexOf("import ") + "import ".length) : trimmed;
  const [left, passphrase] = payload.split("::");
  if (!left || !passphrase) {
    throw new Error("Invalid token. Expected <slug>@<namespace>::<passphrase>");
  }
  const atIndex = left.lastIndexOf("@");
  if (atIndex < 1) {
    throw new Error("Invalid token. Missing slug or namespace.");
  }
  const slug = normalizeSlug(left.slice(0, atIndex));
  const namespace = left.slice(atIndex + 1);
  if (!slug || !namespace || !passphrase) {
    throw new Error("Invalid token. Expected <slug>@<namespace>::<passphrase>");
  }
  return { slug, namespace, passphrase };
}
function stateKey(namespace, streamPath) {
  return `${namespace}:${streamPath}`;
}
function getSelectedBucket(config) {
  const slug = config.selectedBucketSlug;
  if (!slug) {
    throw new Error("No bucket selected. Create one with `npx streambin.xyz create` or import one first.");
  }
  const bucket = config.buckets[slug];
  if (!bucket) {
    throw new Error("Selected bucket is missing. Run `npx streambin.xyz list` and pick another with `use`.");
  }
  return bucket;
}
function clientForBucket(bucket) {
  return new StreambinClient({
    baseUrl: bucket.baseUrl,
    namespace: bucket.namespace,
    passphrase: bucket.passphrase
  });
}
async function createBucket(inputSlug, baseUrl, options) {
  const config = await readConfig();
  const existing = new Set(Object.keys(config.buckets));
  const slug = inputSlug ? normalizeSlug(inputSlug) : generateSlug(existing);
  if (!slug) {
    throw new Error("Invalid slug.");
  }
  if (config.buckets[slug]) {
    throw new Error(`Bucket slug already exists: ${slug}`);
  }
  const namespace = options?.namespace?.trim() || randomUUID();
  const passphrase = options?.passphrase?.trim() || generatePassphrase();
  if (!namespace) {
    throw new Error("Invalid namespace.");
  }
  if (!passphrase) {
    throw new Error("Invalid passphrase.");
  }
  const bucket = {
    slug,
    namespace,
    passphrase,
    baseUrl: baseUrl.replace(/\/$/, ""),
    createdAt: Date.now()
  };
  config.buckets[slug] = bucket;
  config.selectedBucketSlug = slug;
  await writeJsonFile(CONFIG_FILE, config);
  console.log(`Created bucket '${slug}' and selected it.`);
  console.log(`Export it with: npx streambin.xyz export ${slug}`);
}
async function listBuckets() {
  const config = await readConfig();
  const entries = Object.values(config.buckets).sort((a, b) => a.createdAt - b.createdAt);
  if (entries.length === 0) {
    console.log("No buckets on this machine. Create one with `npx streambin.xyz create`.");
    return;
  }
  for (const bucket of entries) {
    const marker = bucket.slug === config.selectedBucketSlug ? "*" : " ";
    console.log(`${marker} ${bucket.slug}  (${bucket.namespace})  ${bucket.baseUrl}`);
  }
}
async function useBucket(slugInput) {
  const config = await readConfig();
  const slug = normalizeSlug(slugInput);
  if (!config.buckets[slug]) {
    throw new Error(`Unknown bucket slug: ${slug}`);
  }
  config.selectedBucketSlug = slug;
  await writeJsonFile(CONFIG_FILE, config);
  console.log(`Selected bucket '${slug}'.`);
}
async function currentBucket() {
  const config = await readConfig();
  const bucket = getSelectedBucket(config);
  console.log(`${bucket.slug} (${bucket.namespace})`);
}
async function exportBucket(slugInput) {
  const config = await readConfig();
  const slug = slugInput ? normalizeSlug(slugInput) : config.selectedBucketSlug;
  if (!slug || !config.buckets[slug]) {
    throw new Error("Bucket not found. Provide a valid slug or select one first.");
  }
  const bucket = config.buckets[slug];
  const token = `${bucket.slug}@${bucket.namespace}::${bucket.passphrase}`;
  console.log(`npx streambin.xyz import ${token}`);
}
async function importBucket(token, baseUrl) {
  const config = await readConfig();
  const parsed = parseBucketImportToken(token);
  const bucket = {
    slug: parsed.slug,
    namespace: parsed.namespace,
    passphrase: parsed.passphrase,
    baseUrl: baseUrl.replace(/\/$/, ""),
    createdAt: Date.now()
  };
  config.buckets[bucket.slug] = bucket;
  config.selectedBucketSlug = bucket.slug;
  await writeJsonFile(CONFIG_FILE, config);
  console.log(`Imported and selected bucket '${bucket.slug}'.`);
}
function wireBucketCommands(commandRoot) {
  commandRoot.command("create").argument("[slug]").option("--name <slug>", "Bucket slug (same as [slug])").option("--namespace <namespace>", "Custom namespace").option("--passphrase <passphrase>", "Custom passphrase").option("--base-url <url>", "API base URL", DEFAULT_BASE_URL).action(
    async (inputSlug, opts) => {
      const slugFromFlag = opts.name ? normalizeSlug(opts.name) : void 0;
      const slugFromArg = inputSlug ? normalizeSlug(inputSlug) : void 0;
      if (slugFromArg && slugFromFlag && slugFromArg !== slugFromFlag) {
        throw new Error("Provide either [slug] or --name, or make them identical.");
      }
      await createBucket(slugFromFlag ?? slugFromArg, opts.baseUrl, {
        namespace: opts.namespace,
        passphrase: opts.passphrase
      });
    }
  );
  commandRoot.command("list").action(async () => {
    await listBuckets();
  });
  commandRoot.command("use").argument("<slug>").action(async (slugInput) => {
    await useBucket(slugInput);
  });
  commandRoot.command("current").action(async () => {
    await currentBucket();
  });
  commandRoot.command("export").argument("[slug]").action(async (slugInput) => {
    await exportBucket(slugInput);
  });
  commandRoot.command("import").argument("<token>").option("--base-url <url>", "API base URL", DEFAULT_BASE_URL).action(async (token, opts) => {
    await importBucket(token, opts.baseUrl);
  });
}
var program = new Command();
program.name("streambin.xyz").description("Encrypted stream buckets for agents").showHelpAfterError();
wireBucketCommands(program);
wireBucketCommands(program.command("buckets").description("Manage local buckets"));
program.command("send").argument("<stream>").argument("<message>").action(async (stream, message) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  const result = await client.appendMessage(stream, message);
  console.log(JSON.stringify(result, null, 2));
});
program.command("tail").argument("<stream>").option("--from <timestamp>").option("--mode <mode>", "message|json|both", "both").option("--interval <ms>", "poll interval in ms", "2000").action(async (stream, opts) => {
  const config = await readConfig();
  const bucket = getSelectedBucket(config);
  const client = clientForBucket(bucket);
  const state = await readState();
  const key = stateKey(bucket.namespace, stream);
  let cursor = Number(opts.from ?? state.cursors[key] ?? 0);
  const intervalMs = Math.max(300, Number(opts.interval));
  while (true) {
    const events = await client.getStream(stream, {
      after: cursor,
      mode: opts.mode
    });
    for (const event of events) {
      cursor = Math.max(cursor, event.timestamp);
      console.log(JSON.stringify(event, null, 2));
    }
    state.cursors[key] = cursor;
    await saveState(state);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
});
program.command("get").argument("<stream>").option("--after <timestamp>").option("--limit <n>", "max 100", "100").option("--mode <mode>", "message|json|both", "both").action(async (stream, opts) => {
  const config = await readConfig();
  const bucket = getSelectedBucket(config);
  const client = clientForBucket(bucket);
  const state = await readState();
  const key = stateKey(bucket.namespace, stream);
  const after = Number(opts.after ?? state.cursors[key] ?? 0);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 100, 100));
  const events = await client.getStream(stream, { after, limit, mode: opts.mode });
  for (const event of events) {
    console.log(JSON.stringify(event, null, 2));
  }
  const latest = events.at(-1);
  if (latest) {
    state.cursors[key] = latest.timestamp;
    await saveState(state);
  }
});
program.command("set-object").argument("<targetPath>").argument("<json>").action(async (targetPath, json) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  await client.setObject(targetPath, JSON.parse(json));
  console.log("ok");
});
program.command("get-object").argument("<targetPath>").action(async (targetPath) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  const value = await client.getObject(targetPath);
  console.log(JSON.stringify(value, null, 2));
});
program.command("update-object").argument("<targetPath>").argument("<json>").action(async (targetPath, json) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  const patch = JSON.parse(json);
  const updated = await client.updateObject(targetPath, patch);
  console.log(JSON.stringify(updated, null, 2));
});
program.command("remove-object").argument("<targetPath>").action(async (targetPath) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  await client.removeObject(targetPath);
  console.log("ok");
});
program.command("listen-object").argument("<targetPath>").action(async (targetPath) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  console.log(`Listening for object updates on ${targetPath}...`);
  client.listenObject(targetPath, (value) => {
    console.log(JSON.stringify({ ts: Date.now(), value }, null, 2));
  });
  await new Promise(() => {
  });
});
program.command("changed-since").argument("<targetPath>").argument("<timestamp>").action(async (targetPath, timestamp) => {
  const bucket = getSelectedBucket(await readConfig());
  const client = clientForBucket(bucket);
  const changed = await client.hasObjectChangedSince(targetPath, Number(timestamp));
  console.log(changed ? "true" : "false");
});
program.parseAsync(process.argv).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
