import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/store-prisma.js", async () => {
  const { InMemoryStore } = await import("./in-memory-store.js");
  return { prismaStore: new InMemoryStore() };
});

import type { FastifyInstance } from "fastify";
import type { Deps } from "../src/services/ports.js";
import { buildApp } from "../src/app.js";
import { prismaStore } from "../src/services/store-prisma.js";

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

function makeDeps(): Deps {
  return {
    store: prismaStore,
    gateway: {
      create: async () => ({ providerPaymentId: "fake", confirmationUrl: "http://x" }),
      refund: async () => undefined,
    },
    queue: { enqueueAdd: async () => undefined, enqueueRemove: async () => undefined },
    notifier: {
      accessGranted: async () => undefined,
      accessRevoked: async () => undefined,
      paymentRefunded: async () => undefined,
      paymentFailed: async () => undefined,
      broadcast: async () => undefined,
    },
    mc: { whitelistAdd: async () => "ok", whitelistRemove: async () => "ok" },
    starsRefund: { refund: async () => undefined },
    serverIp: "play.test",
    webUrl: "http://localhost:3000",
  };
}

let app: FastifyInstance;

function botSession(extra: Record<string, unknown> = {}) {
  return {
    method: "POST" as const,
    url: "/auth/bot-session",
    headers: { "x-internal-token": INTERNAL_TOKEN },
    payload: { tgId: "777000111", firstName: "Ratelimit", ...extra },
  };
}

beforeAll(async () => {
  app = await buildApp({ deps: makeDeps(), skipHealthInfra: true });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("rate limit: /auth/bot-session 10/мин по IP", () => {
  it("первые 10 запросов — 200", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject(botSession());
      expect(res.statusCode, `запрос #${i + 1}`).toBe(200);
    }
  });

  it("11-й запрос в той же минуте → 429", async () => {
    const res = await app.inject(botSession());
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("лимит относится только к bot-session: прочие роуты живы", async () => {
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    const season = await app.inject({ method: "GET", url: "/public/season" });
    expect(season.statusCode).toBe(200);
  });

  it("неверный токен тоже занимает слот лимита (брутфорус не даёт дышать)", async () => {
    // тот же IP уже выжат — даже с неверным токеном будет 429, а не 403
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": "totally-wrong-token" },
      payload: { tgId: "1" },
    });
    expect(res.statusCode).toBe(429);
  });

  it("глобальный лимит (1200/мин) не задет: параллельные пинги 200", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: "GET", url: "/public/season" }))
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });
});
