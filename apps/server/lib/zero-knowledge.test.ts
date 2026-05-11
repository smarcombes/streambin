import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER_ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".git",
  "public",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
const FORBIDDEN_IMPORTS = ["@streambin/crypto"];

async function collectSourceFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") {
      // skip hidden files except .env
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await collectSourceFiles(full, acc);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        acc.push(full);
      }
    }
  }
  return acc;
}

describe("zero-knowledge guardrail", () => {
  it("apps/server never imports @streambin/crypto", async () => {
    const files = await collectSourceFiles(SERVER_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      if (file === __filename) {
        continue;
      }
      const content = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        if (content.includes(forbidden)) {
          offenders.push(`${path.relative(SERVER_ROOT, file)} references ${forbidden}`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("apps/server package.json does not depend on @streambin/crypto", async () => {
    const pkg = JSON.parse(await readFile(path.join(SERVER_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@streambin/crypto"]).toBeUndefined();
    expect(pkg.devDependencies?.["@streambin/crypto"]).toBeUndefined();
    expect(pkg.peerDependencies?.["@streambin/crypto"]).toBeUndefined();
  });
});
