import { describe, expect, it } from "vitest";
import { fnv1aHash, normalizePath, objectUpdateStreamPath } from "./index";

describe("shared helpers", () => {
  it("normalizes paths", () => {
    expect(normalizePath("/alpha//beta/ ")).toBe("alpha/beta");
  });

  it("hashes deterministically", () => {
    expect(fnv1aHash("same-input")).toBe(fnv1aHash("same-input"));
    expect(fnv1aHash("a")).not.toBe(fnv1aHash("b"));
  });

  it("creates object update stream paths", () => {
    const path = objectUpdateStreamPath("users/42/profile");
    expect(path.startsWith("_docs/")).toBe(true);
    expect(path.includes("users_42_profile")).toBe(true);
  });
});
