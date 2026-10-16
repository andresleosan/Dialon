import { expect, it } from "vitest";
import { createApiClient } from "./index";

it("acepta una página legal de 50 usuarios que supera 16 KiB", async () => {
  const users = Array.from({ length: 50 }, (_, i) => ({
    uid: String(i).padStart(3, "0") + "u".repeat(125),
    email: "e".repeat(308) + "@example.com",
    createdAt: 1,
    subscription: { status: "inactive", plan: null, expiresAt: null, limits: null, usage: { requests: 0, chars: 0 } },
  }));
  const body = JSON.stringify({ users, nextCursor: null });
  expect(new TextEncoder().encode(body).length).toBeGreaterThan(16 * 1024);
  const api = createApiClient({ baseUrl: "https://api.example", getIdToken: () => Promise.resolve("synthetic"), fetch: () => Promise.resolve(new Response(body)) });
  const result = await api.listUsers({ limit: 50 });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.users).toHaveLength(50);
});
