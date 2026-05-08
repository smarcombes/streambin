import { describe, expect, it, vi } from "vitest";
import { encryptJson } from "@streambin/crypto";
import { StreambinClient } from "./index";

describe("sdk", () => {
  it("filters and decodes stream messages", async () => {
    const payload = await encryptJson("pw", { t: "m", d: "hello" });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          events: [
            {
              event: "message",
              id: "1",
              timestamp: 1,
              string: JSON.stringify(payload),
            },
          ],
        }),
      );
    });

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const events = await client.getStream("chat/general", { mode: "message" });
    expect(events).toHaveLength(1);
    expect(events[0].decoded).toEqual({ type: "message", value: "hello" });
  });

  it("checks object changes from object stream", async () => {
    const payload = await encryptJson("pw", { foo: "bar" });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          events: [
            {
              event: "message",
              id: "1",
              timestamp: 101,
              string: JSON.stringify(payload),
            },
          ],
        }),
      );
    });

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.hasObjectChangedSince("state/current", 100)).resolves.toBe(true);
  });

  it("applies firebase-style patch updates with dotted paths", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: await encryptJson("pw", { firstName: "Ada", lastName: "Lovelace" }),
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const updated = await client.updateObject<Record<string, unknown>>("profile", {
      firstName: "Ada",
      age: 36,
      "photo.url": "https://example.test/photo.jpg",
    });

    expect(updated).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      age: 36,
      photo: { url: "https://example.test/photo.jpg" },
    });
  });

  it("upserts on updateObject when doc GET returns 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const updated = await client.updateObject<Record<string, unknown>>("profile", {
      firstName: "Ada",
      "photo.url": "https://example.test/photo.jpg",
    });

    expect(updated).toEqual({
      firstName: "Ada",
      photo: { url: "https://example.test/photo.jpg" },
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://example.test/api/docs/ns/profile");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("removeObject writes tombstone then deletes doc", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = new StreambinClient({
      baseUrl: "https://example.test",
      namespace: "ns",
      passphrase: "pw",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.removeObject("profile");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.test/api/docs/ns/profile",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
