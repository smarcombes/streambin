import { describe, expect, it } from "vitest";
import {
  DOC_TTL_SECONDS,
  FILE_TTL_SECONDS,
  docKey,
  fileHashInput,
  fileIdFromNamespacePath,
  fileLookupKey,
  normalizePath,
  objectUpdateStreamPath,
  streamKey,
} from "./keys";

describe("server path conventions", () => {
  it("builds deterministic stream and doc keys", () => {
    expect(streamKey("ns", "a/b")).toBe("sb:stream:ns:a/b");
    expect(docKey("ns", ["a", "b"])).toBe("sb:doc:ns:a/b");
  });

  it("normalizes and derives object update stream path", () => {
    const normalized = normalizePath("//users/7/state//");
    const channel = objectUpdateStreamPath(normalized);

    expect(normalized).toBe("users/7/state");
    expect(channel.startsWith("_docs/")).toBe(true);
  });

  it("creates deterministic file hashes and lookup keys", () => {
    const hashA = fileIdFromNamespacePath("ns", "assets/logo.png");
    const hashB = fileIdFromNamespacePath("ns", ["assets", "logo.png"]);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(fileHashInput("ns", "/assets/logo.png/")).toBe("ns/assets/logo.png");
    expect(fileLookupKey("ns", "assets/logo.png")).toBe("sb:file:ns:assets/logo.png");
  });

  it("reuses the 3-day retention constant for files", () => {
    expect(FILE_TTL_SECONDS).toBe(DOC_TTL_SECONDS);
  });
});
