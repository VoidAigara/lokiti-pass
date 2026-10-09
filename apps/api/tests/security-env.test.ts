/**
 * Изоляция среды: здесь env отличается от vitest.config.ts.
 * Значения выставляются ДО динамического импорта app.js (config читает env
 * при загрузке модуля), а сам app импортируется только динамически.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.ADMIN_IP_ALLOWLIST = "10.0.0.1"; // чужой IP → 403
process.env.DEMO_WEBHOOK_TRUST = "false"; // demo-вебхуки запрещены

vi.mock("../src/services/store-prisma.js", async () => {
  const { InMemoryStore } = await import("./in-memory-store.js");
  return { prismaStore: new InMemoryStore() };
});

import type { FastifyInstance } from "fastify";
import type { Deps } from "../src/services/ports.js";
import type { InMemoryStore } from "./in-memory-store.js";

let app: FastifyInstance;
let adminAuth: { authorization: string };

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  const { prismaStore } = await import("../src/services/store-prisma.js");
  const { signAccessToken, hashToken } = await import("../src/lib/jwt.js");

  const store = prismaStore as unknown as InMemoryStore;
  const deps: Deps = {
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

  app = await buildApp({ deps, skipHealthInfra: true });
  await app.ready();

  // валидный админский токен — чтобы доказать: блокирует именно IP, а не auth
  const user = await store.upsertUser({ tgId: "968363862", isAdmin: true });
  const token = await signAccessToken({
    sub: user.id,
    tgId: user.tgId,
    isAdmin: true,
    sid: "sid-security-env",
  });
  await store.createSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
  });
  adminAuth = { authorization: `Bearer ${token}` };
});

afterAll(async () => {
  await app.close();
});

describe("ADMIN_IP_ALLOWLIST=10.0.0.1", () => {
  it("публичные роуты не задеты", async () => {
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    const season = await app.inject({ method: "GET", url: "/public/season" });
    expect(season.statusCode).toBe(200);
  });

  it("анонимный запрос в админку с чужого IP → 403 (IP-проверка раньше auth)", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/stats" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/белом списке/i);
  });

  it("валидный админский токен с чужого IP всё равно → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/stats",
      headers: adminAuth,
    });
    expect(res.statusCode).toBe(403);
  });

  it("мутация админки тоже закрыта по IP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/broadcast",
      headers: adminAuth,
      payload: { text: "не должно пройти", target: "ALL" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("не-админ роуты с тем же токеном работают (блокируется только /admin)", async () => {
    const res = await app.inject({ method: "GET", url: "/me", headers: adminAuth });
    expect(res.statusCode).toBe(200);
  });
});

describe("DEMO_WEBHOOK_TRUST=false", () => {
  const goodBody = {
    object: {
      id: "yp_sec_1",
      status: "succeeded",
      paid: true,
      metadata: { paymentId: "pay_whatever" },
    },
  };

  it("чужой IP вебхука → 403 до какой-либо обработки", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      remoteAddress: "8.8.8.8",
      payload: goodBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("доверенный IP, но YooKassa не настроена и demo-доверие выключено → 502", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: goodBody,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("YOOKASSA_NOT_CONFIGURED");
  });

  it("кривое тело от доверенного IP → 400 (валидация до выдачи)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: { object: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION");
  });
});

describe("прочая авторизация не задета новым env", () => {
  it("bot-session без токена → 403 (env не ломает внутреннюю авторизацию)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      payload: { tgId: "123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("webapp с мусором → 401, а не 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/webapp",
      payload: { initData: "user=%7B%22id%22%3A1%7D&hash=deadbeef" },
    });
    expect(res.statusCode).toBe(401);
  });
});
