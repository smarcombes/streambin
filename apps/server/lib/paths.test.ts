import { describe, expect, it } from "vitest";
import { docKey, normalizePath, objectUpdateStreamPath, streamKey } from "./keys";

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
});
