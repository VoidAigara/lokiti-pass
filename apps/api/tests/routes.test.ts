import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../src/services/ports.js";

// ---------------------------------------------------------------------------
// Моки: роуты используют prismaStore напрямую (синглтон), а не deps.store.
// Подменяем модуль на InMemoryStore, чтобы тесты были герметичными.
vi.mock("../src/services/store-prisma.js", async () => {
  const { InMemoryStore } = await import("./in-memory-store.js");
  return { prismaStore: new InMemoryStore() };
});

// Telegram-вызовы не должны ходить в сеть: собираем отправленные сообщения.
vi.mock("../src/lib/telegram.js", () => {
  const sent: Array<{ chatId: string; text: string }> = [];
  return {
    sent,
    sendMessage: async (chatId: number | string, text: string) => {
      sent.push({ chatId: String(chatId), text });
      return true;
    },
    notifyUser: async (tgId: unknown, text: string) => {
      sent.push({ chatId: String(tgId), text });
    },
    answerCallbackQuery: async () => undefined,
    setMyCommands: async () => undefined,
    getChatMemberCount: async () => 0,
    refundStarPayment: async () => undefined,
  };
});

import { prismaStore } from "../src/services/store-prisma.js";
import * as telegram from "../src/lib/telegram.js";
import { InMemoryStore } from "./in-memory-store.js";
import { buildApp } from "../src/app.js";
import { hashToken, signAccessToken } from "../src/lib/jwt.js";
import { processWhitelistAdd } from "../src/services/settle.js";
import { TICKET_LIMITS } from "@loki/shared";

const store = prismaStore as unknown as InMemoryStore;
const tgSent = (telegram as unknown as { sent: Array<{ chatId: string; text: string }> }).sent;

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_TG_ID = 968363862;
const WEB_ORIGIN = "http://localhost:3000";

// ------------------------------- фикстуры ----------------------------------

const notifierSpy = {
  granted: [] as string[],
  broadcasts: [] as Array<{ tgId: string; html: string }>,
};

const jobs = { add: [] as string[], remove: [] as string[] };
const refunds: Array<{ providerPaymentId: string; amount?: number }> = [];
const starsRefunds: Array<{ tgId: string; chargeId: string }> = [];

function makeDeps(): Deps {
  return {
    store: prismaStore,
    gateway: {
      create: async () => ({
        providerPaymentId: `fake_${Math.random().toString(36).slice(2, 10)}`,
        confirmationUrl: `${WEB_ORIGIN}/profile?demo=1`,
      }),
      refund: async (input) => {
        refunds.push({ providerPaymentId: input.providerPaymentId, amount: input.amount });
      },
    },
    queue: {
      enqueueAdd: async (job) => {
        jobs.add.push(job.playerId);
      },
      enqueueRemove: async (job) => {
        jobs.remove.push(job.playerId);
      },
    },
    notifier: {
      accessGranted: async (tgId) => {
        notifierSpy.granted.push(tgId);
      },
      accessRevoked: async () => undefined,
      paymentRefunded: async () => undefined,
      paymentFailed: async () => undefined,
      broadcast: async (tgId, html) => {
        notifierSpy.broadcasts.push({ tgId, html });
      },
    },
    mc: {
      whitelistAdd: async () => "ok",
      whitelistRemove: async () => "ok",
    },
    starsRefund: {
      refund: async (input) => {
        starsRefunds.push(input);
      },
    },
    serverIp: "play.test",
    webUrl: WEB_ORIGIN,
  };
}

function signInitData(fields: Record<string, string>): string {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

let app: FastifyInstance;
let tgSeq = 700_000_000;
const deps = makeDeps();

interface Session {
  tgId: number;
  token: string;
  cookie: string;
  userId: string;
  isAdmin: boolean;
  auth: { headers: { authorization: string } };
}

async function login(tgId?: number, name = "Tester"): Promise<Session> {
  const id = tgId ?? ++tgSeq;
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAHtest",
    user: JSON.stringify({ id, first_name: name, username: "tester" }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/auth/webapp",
    payload: { initData },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const setCookie = res.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return {
    tgId: id,
    token: body.token,
    cookie: cookie.split(";")[0],
    userId: body.user.id,
    isAdmin: body.user.isAdmin,
    auth: { headers: { authorization: `Bearer ${body.token}` } },
  };
}

async function ensureSeason(): Promise<{ id: string }> {
  const active = await store.getActiveSeason();
  if (active) return active;
  return store.createSeason({
    number: 1,
    name: "Тестовый сезон",
    priceNew: 50_000,
    priceRenew: 20_000,
    activate: true,
  });
}

function json(method: "GET" | "POST" | "PATCH", url: string, session?: Session) {
  return {
    method,
    url,
    ...(session ? { headers: { ...session.auth.headers } } : {}),
  };
}

beforeAll(async () => {
  app = await buildApp({ deps, skipHealthInfra: true });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// =============================== ТЕСТЫ =====================================

describe("стартовое состояние (без сезона): корень, публичное, авторизация", () => {
  it("GET / отдаёт имя и версию", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Loki Ti Pass API", version: "1.0.0" });
  });

  it("GET /health без инфраструктуры → 200 ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("неизвестный маршрут → 404 NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("NOT_FOUND");
  });

  it("CORS: свой origin получает ACAO", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("CORS: чужой origin не получает ACAO", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("security header: X-Content-Type-Options: nosniff", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /public/season без сезона: null + дефолтные цены", async () => {
    const res = await app.inject({ method: "GET", url: "/public/season" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBeNull();
    expect(body.prices).toEqual({ new: 50_000, renew: 20_000 });
  });

  it("GET /public/status отвечает 200 и содержит ok", async () => {
    const res = await app.inject({ method: "GET", url: "/public/status" });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().ok).toBe("boolean");
  });

  it("/me без сезона → оффер NO_SEASON", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/me", s) });
    expect(res.statusCode).toBe(200);
    expect(res.json().offer.kind).toBe("NO_SEASON");
  });

  it("/payments/create без сезона → 409 NO_SEASON", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "NoSeasonNick" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_SEASON");
  });

  // ------------------------- bot-session -------------------------
  it("bot-session без x-internal-token → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      payload: { tgId: "123" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("bot-session с неверным токеном → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": `${INTERNAL_TOKEN}X` },
      payload: { tgId: "123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("bot-session: токен в query не принимается", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/auth/bot-session?token=${encodeURIComponent(INTERNAL_TOKEN)}`,
      payload: { tgId: "123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("bot-session: внутренний токен другой длины → 403 (timing-safe)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": INTERNAL_TOKEN.slice(0, -1) },
      payload: { tgId: "123" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("bot-session: валидный токен → JWT и пользователь-админ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": INTERNAL_TOKEN },
      payload: { tgId: String(ADMIN_TG_ID), firstName: "Admin" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe("string");
    expect(body.user.isAdmin).toBe(true);
  });

  it("bot-session: обычный tgId → не админ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": INTERNAL_TOKEN },
      payload: { tgId: "424242" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.isAdmin).toBe(false);
  });

  it("bot-session: кривой tgId → 400 VALIDATION", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/bot-session",
      headers: { "x-internal-token": INTERNAL_TOKEN },
      payload: { tgId: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION");
  });

  // ------------------------- webapp initData -------------------------
  it("webapp: подделанный hash → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/webapp",
      payload: { initData: "user=%7B%22id%22%3A1%7D&hash=deadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("webapp: слишком короткое тело → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/webapp",
      payload: { initData: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION");
  });

  it("webapp: валидные данные → JWT + httpOnly cookie + user", async () => {
    const s = await login();
    expect(s.token.length).toBeGreaterThan(20);
    expect(s.cookie).toMatch(/^loki_token=/);
    expect(s.isAdmin).toBe(false);
  });

  it("/me с cookie → 200", async () => {
    const s = await login();
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.tgId).toBe(String(s.tgId));
  });

  it("/me с Bearer → 200", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/me", s) });
    expect(res.statusCode).toBe(200);
  });

  it("/me без авторизации → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("UNAUTHORIZED");
  });

  it("/me с мусорным JWT → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer not.a.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("/me с подделанной подписью → 401", async () => {
    const s = await login();
    const tampered = `${s.token.slice(0, -3)}abc`;
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("токен в query string не авторизует → 401", async () => {
    const s = await login();
    const res = await app.inject({
      method: "GET",
      url: `/me?token=${encodeURIComponent(s.token)}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("JWT с истёкшим exp → 401 (Сессия истекла)", async () => {
    const u = await store.upsertUser({ tgId: "900001" });
    const expired = await new SignJWT({ tgId: u.tgId, isAdmin: false })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(u.id)
      .setJti("sid-expired")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setIssuer("loki-pass")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await store.createSession({
      userId: u.id,
      tokenHash: hashToken(expired),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/истекла/i);
  });

  it("живой JWT, но отозванная сессия → 401", async () => {
    const u = await store.upsertUser({ tgId: "900002" });
    const token = await signAccessToken({
      sub: u.id,
      tgId: u.tgId,
      isAdmin: false,
      sid: "sid-revoked",
    });
    await store.createSession({
      userId: u.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() - 1000), // уже истекла
    });
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("забаненный пользователь не может войти через webapp → 403", async () => {
    const u = await store.upsertUser({ tgId: "900003" });
    store.users.set(u.id, { ...u, isBanned: true });
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAHbanned",
      user: JSON.stringify({ id: 900003, first_name: "Banned" }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/webapp",
      payload: { initData },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("logout удаляет сессию: повторный запрос с тем же токеном → 401", async () => {
    const s = await login();
    const out = await app.inject({ ...json("POST", "/auth/logout", s) });
    expect(out.statusCode).toBe(200);
    const res = await app.inject({ ...json("GET", "/me", s) });
    expect(res.statusCode).toBe(401);
  });

  it("/auth/me отражает пользователя", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/auth/me", s) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.tgId).toBe(String(s.tgId));
  });
});

describe("/me: профиль, ник, тикеты, заявки (сезон объявлен)", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  it("новый игрок: оффер NEW 500 ₽, игрока ещё нет", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/me", s) });
    const body = res.json();
    expect(body.offer).toMatchObject({ kind: "NEW", amount: 50_000, type: "NEW" });
    expect(body.player).toBeNull();
    expect(body.payments).toEqual([]);
  });

  it("первая привязка ника → 200", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick", s),
      payload: { mcNick: "FirstNick" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mcNick: "FirstNick", status: "PENDING" });
  });

  it("повторный /me/nick → 409", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "DupNick" } });
    const again = await app.inject({
      ...json("POST", "/me/nick", s),
      payload: { mcNick: "OtherNick" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("CONFLICT");
  });

  it("слишком короткий ник → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick", s),
      payload: { mcNick: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("зарезервированный ник admin → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick", s),
      payload: { mcNick: "admin" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ник с пробелом → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick", s),
      payload: { mcNick: "Bad Nick" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ник, занятый другим игроком → 409 NICK_TAKEN", async () => {
    const a = await login();
    await app.inject({ ...json("POST", "/me/nick", a), payload: { mcNick: "TakenNick" } });
    const b = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick", b),
      payload: { mcNick: "TakenNick" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NICK_TAKEN");
  });

  it("тикет создаётся (201) и виден только владельцу", async () => {
    const a = await login();
    const b = await login();
    const created = await app.inject({
      ...json("POST", "/me/tickets", a),
      payload: { type: "SUPPORT", text: "Помогите с доступом" },
    });
    expect(created.statusCode).toBe(201);

    await app.inject({
      ...json("POST", "/me/tickets", b),
      payload: { type: "SUPPORT", text: "Другой текст тикета" },
    });

    const mine = await app.inject({ ...json("GET", "/me/tickets", a) });
    const tickets = mine.json().tickets as Array<{ userId: string; payload: { text: string } }>;
    expect(tickets).toHaveLength(1);
    expect(tickets[0].userId).toBe(a.userId);
    expect(tickets[0].payload.text).toBe("Помогите с доступом");
  });

  it("тикет с неизвестным типом → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/tickets", s),
      payload: { type: "HACK", text: "текст" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("тикет с текстом короче 3 символов → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/tickets", s),
      payload: { type: "SUPPORT", text: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("тикет длиннее лимита → 400", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/tickets", s),
      payload: { type: "SUPPORT", text: "а".repeat(1001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("заявка на смену ника без привязанного ника → 409", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/me/nick-request", s),
      payload: { newNick: "NewNickOne" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("заявка на смену ника → 201, второй открытой не бывает", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "OldNickOne" } });
    const first = await app.inject({
      ...json("POST", "/me/nick-request", s),
      payload: { newNick: "NewNickTwo" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      ...json("POST", "/me/nick-request", s),
      payload: { newNick: "NewNickThree" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("заявка со своим текущим ником → 409", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "SameNickOk" } });
    const res = await app.inject({
      ...json("POST", "/me/nick-request", s),
      payload: { newNick: "SameNickOk" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("заявка на чужой ник → 409 NICK_TAKEN", async () => {
    const a = await login();
    await app.inject({ ...json("POST", "/me/nick", a), payload: { mcNick: "OwnerNickZ" } });
    const b = await login();
    await app.inject({ ...json("POST", "/me/nick", b), payload: { mcNick: "MyOwnNickZ" } });
    const res = await app.inject({
      ...json("POST", "/me/nick-request", b),
      payload: { newNick: "OwnerNickZ" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NICK_TAKEN");
  });

  it("заявка с невалидным ником → 400", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "ValidNickQ" } });
    const res = await app.inject({
      ...json("POST", "/me/nick-request", s),
      payload: { newNick: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("payments: создание и идемпотентность", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  it("без авторизации → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/payments/create", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("без привязанного ника → 400 NICK_REQUIRED", async () => {
    const s = await login();
    const res = await app.inject({ ...json("POST", "/payments/create", s), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NICK_REQUIRED");
  });

  it("создание с mcNick → ссылка и оффер NEW", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "PayNickOne" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.confirmationUrl).toBeTruthy();
    expect(body.reused).toBe(false);
    expect(body.offer).toMatchObject({ kind: "NEW", amount: 50_000 });
  });

  it("повторный вызов идемпотентен: тот же платёж, reused=true", async () => {
    const s = await login();
    const first = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "IdemNickOne" },
    });
    const second = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().reused).toBe(true);
    expect(second.json().paymentId).toBe(first.json().paymentId);
  });

  it("10 параллельных create → один и тот же платёж", async () => {
    const s = await login();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          ...json("POST", "/payments/create", s),
          payload: { mcNick: "ConcNickOne" },
        })
      )
    );
    const ids = new Set(results.map((r) => r.json().paymentId));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("forceType=RENEW при оффере NEW → 409", async () => {
    const s = await login();
    const res = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "ForceNickOne", type: "RENEW" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CONFLICT");
  });

  it("игрок с активным доступом → 409 ALREADY_ACTIVE", async () => {
    const s = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "ActiveNickOne" },
    });
    const paymentId = created.json().paymentId;
    // подтверждаем через demo-вебхук
    const wh = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: {
        object: {
          id: "fake_active_1",
          status: "succeeded",
          paid: true,
          metadata: { paymentId },
        },
      },
    });
    expect(wh.statusCode).toBe(200);
    // симулируем воркер: выдача whitelist переводит игрока в ACTIVE
    const paid = await store.getPaymentById(paymentId);
    expect(paid?.status).toBe("PAID");
    const grant = await processWhitelistAdd(deps, {
      paymentId,
      playerId: paid!.playerId!,
      nick: "ActiveNickOne",
      seasonId: paid!.seasonId!,
    });
    expect(grant.status).toBe("granted");
    const again = await app.inject({ ...json("POST", "/payments/create", s), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("ALREADY_ACTIVE");
  });

  it("забаненный ник → 403 при создании", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "BannedNickX" } });
    const p = await store.getPlayerByNickLower("bannednickx");
    await store.updatePlayer(p!.id, { status: "BANNED", banReason: "тест" });
    const res = await app.inject({ ...json("POST", "/payments/create", s), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });
});

describe("payments: просмотр", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  it("свой платёж → 200", async () => {
    const s = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "ViewNickOne" },
    });
    const res = await app.inject({
      ...json("GET", `/payments/${created.json().paymentId}`, s),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment.id).toBe(created.json().paymentId);
  });

  it("чужой платёж → 404 (не утекает)", async () => {
    const a = await login();
    const b = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", a),
      payload: { mcNick: "SecretNickOne" },
    });
    const res = await app.inject({
      ...json("GET", `/payments/${created.json().paymentId}`, b),
    });
    expect(res.statusCode).toBe(404);
  });

  it("неизвестный id → 404", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/payments/does-not-exist", s) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Telegram Stars", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  async function starsInvoice(s: Session, mcNick?: string) {
    return app.inject({
      ...json("POST", "/payments/stars/invoice", s),
      ...(mcNick ? { payload: { mcNick } } : { payload: {} }),
    });
  }

  it("invoice: stars = ₽/100/2, платёж создан как STARS", async () => {
    const s = await login();
    const res = await starsInvoice(s, "StarsNickOne");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.amount).toBe(50_000);
    expect(body.stars).toBe(250); // 500 ₽ / 2 ₽ за звезду
    const payment = await store.getPaymentById(body.paymentId);
    expect(payment?.provider).toBe("STARS");
    expect(payment?.status).toBe("PENDING");
    expect(payment?.confirmationUrl).toBeNull();
  });

  it("confirm с неверным числом звёзд → 400 с эталоном в сообщении", async () => {
    const s = await login();
    const inv = (await starsInvoice(s, "StarsNickTwo")).json();
    const res = await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_wrong_1",
        starsAmount: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/250/);
  });

  it("confirm чужого paymentId → 404", async () => {
    const a = await login();
    const b = await login();
    const inv = (await starsInvoice(a, "StarsNickThree")).json();
    const res = await app.inject({
      ...json("POST", "/payments/stars", b),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_1",
        starsAmount: 250,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("confirm YooKassa-платежа через /payments/stars → 409", async () => {
    const s = await login();
    const yk = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "YkNickConfirm" },
    });
    const res = await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: yk.json().paymentId,
        telegramPaymentChargeId: "chg_2",
        starsAmount: 250,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CONFLICT");
  });

  it("confirm с charge id, уже привязанным к другому списанию → 409", async () => {
    const s = await login();
    const inv = (await starsInvoice(s, "StarsNickFour")).json();
    await store.updatePayment(inv.paymentId, { providerPaymentId: "chg_original" });
    const res = await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_attacker",
        starsAmount: 250,
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("успешный confirm: PAID, charge id сохранён, выдача в очереди", async () => {
    const s = await login();
    const inv = (await starsInvoice(s, "StarsNickFive")).json();
    const jobsBefore = jobs.add.length;
    const res = await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_success_1",
        starsAmount: 250,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, firstTime: true });
    const payment = await store.getPaymentById(inv.paymentId);
    expect(payment?.status).toBe("PAID");
    expect(payment?.providerPaymentId).toBe("chg_success_1");
    expect(jobs.add.length).toBe(jobsBefore + 1);
  });

  it("повторный confirm уже оплаченного → already=true, без двойной выдачи", async () => {
    const s = await login();
    const inv = (await starsInvoice(s, "StarsNickSix")).json();
    await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_repeat",
        starsAmount: 250,
      },
    });
    const jobsAfterFirst = jobs.add.length;
    const again = await app.inject({
      ...json("POST", "/payments/stars", s),
      payload: {
        paymentId: inv.paymentId,
        telegramPaymentChargeId: "chg_repeat",
        starsAmount: 250,
      },
    });
    expect(again.json()).toMatchObject({ ok: true, already: true });
    expect(jobs.add.length).toBe(jobsAfterFirst);
  });

  it("invoice без ника игрока → 400 NICK_REQUIRED", async () => {
    const s = await login();
    const res = await starsInvoice(s);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("NICK_REQUIRED");
  });
});

describe("webhook YooKassa (demo-режим)", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  async function createPayment(s: Session, mcNick: string): Promise<string> {
    const res = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick },
    });
    expect(res.statusCode).toBe(200);
    return res.json().paymentId;
  }

  it("чужой IP → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      remoteAddress: "8.8.8.8",
      payload: { object: { id: "yp_x", status: "succeeded" } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("кривое тело → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: { object: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("succeeded + metadata.paymentId → платёж PAID", async () => {
    const s = await login();
    const paymentId = await createPayment(s, "WhNickOne");
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: {
        object: {
          id: "yp_wh_1",
          status: "succeeded",
          paid: true,
          metadata: { paymentId },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect((await store.getPaymentById(paymentId))?.status).toBe("PAID");
  });

  it("повторный вебхук идемпотентен: выдача не дублируется", async () => {
    const s = await login();
    const paymentId = await createPayment(s, "WhNickTwo");
    const payload = {
      object: {
        id: "yp_wh_2",
        status: "succeeded",
        metadata: { paymentId },
      },
    };
    await app.inject({ method: "POST", url: "/payments/webhook", payload });
    const jobsAfterFirst = jobs.add.length;
    const second = await app.inject({ method: "POST", url: "/payments/webhook", payload });
    expect(second.statusCode).toBe(200);
    expect(jobs.add.length).toBe(jobsAfterFirst);
  });

  it("canceled → платёж FAILED", async () => {
    const s = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "WhNickThree" },
    });
    const payment = await store.getPaymentById(created.json().paymentId);
    // demo-ветка canceled ищет платёж по providerPaymentId (как в бою)
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: {
        object: {
          id: payment!.providerPaymentId,
          status: "canceled",
          metadata: { paymentId: payment!.id },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect((await store.getPaymentById(payment!.id))?.status).toBe("FAILED");
  });

  it("неизвестный paymentId → 200 (no-op, но вебхук принят)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: {
        object: { id: "yp_unknown", status: "succeeded", metadata: { paymentId: "nope" } },
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("админка", () => {
  let admin: Session;

  beforeAll(async () => {
    await ensureSeason();
    admin = await login(ADMIN_TG_ID, "Admin");
    expect(admin.isAdmin).toBe(true);
  });

  it("аноним → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/stats" });
    expect(res.statusCode).toBe(401);
  });

  it("обычный пользователь → 403", async () => {
    const s = await login();
    const res = await app.inject({ ...json("GET", "/admin/stats", s) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("админ получает stats", async () => {
    const res = await app.inject({ ...json("GET", "/admin/stats", admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("season");
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("conversion");
    expect(Array.isArray(body.recentPayments)).toBe(true);
    expect(Array.isArray(body.seasons)).toBe(true);
  });

  it("список платежей + фильтр по статусу", async () => {
    const all = await app.inject({ ...json("GET", "/admin/payments?limit=5", admin) });
    expect(all.statusCode).toBe(200);
    expect(all.json().payments.length).toBeGreaterThan(0);
    const paid = await app.inject({
      ...json("GET", "/admin/payments?status=PAID&limit=200", admin),
    });
    expect(paid.statusCode).toBe(200);
    expect(
      (paid.json().payments as Array<{ status: string }>).every((p) => p.status === "PAID")
    ).toBe(true);
  });

  it("лимит в query ограничивает выдачу", async () => {
    const res = await app.inject({ ...json("GET", "/admin/payments?limit=2", admin) });
    expect(res.json().payments.length).toBeLessThanOrEqual(2);
    expect(res.json().limit).toBe(2);
  });

  it("GET /admin/tickets/limits отдаёт лимиты из @loki/shared", async () => {
    const res = await app.inject({ ...json("GET", "/admin/tickets/limits", admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().limits).toEqual(TICKET_LIMITS);
    expect(TICKET_LIMITS.supportText).toBeGreaterThan(0);
  });

  it("вайп: цена продления ≥ первичной → 400", async () => {
    const res = await app.inject({
      ...json("POST", "/admin/seasons/wipe", admin),
      payload: { name: "Плохой сезон", priceNew: 10_000, priceRenew: 20_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION");
  });

  it("вайп: объявляет сезон, пишет аудит", async () => {
    const res = await app.inject({
      ...json("POST", "/admin/seasons/wipe", admin),
      payload: { name: "Сезон тестовый", priceNew: 60_000, priceRenew: 25_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().season).toMatchObject({ name: "Сезон тестовый", isActive: true });
    const audit = await app.inject({ ...json("GET", "/admin/audit", admin) });
    const actions = (audit.json().audit as Array<{ action: string }>).map((a) => a.action);
    expect(actions.some((a) => a.includes("WIPE") || a.includes("SEASON"))).toBe(true);
  });

  it("PATCH цен сезона → 200; нулевая цена → 400", async () => {
    const season = await store.getActiveSeason();
    const ok = await app.inject({
      ...json("PATCH", `/admin/seasons/${season!.id}`, admin),
      payload: { priceNew: 70_000, priceRenew: 30_000 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().season.priceNew).toBe(70_000);
    const bad = await app.inject({
      ...json("PATCH", `/admin/seasons/${season!.id}`, admin),
      payload: { priceNew: 0, priceRenew: 1 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("возврат YooKassa-платежа: PAID → REFUNDED, очередь на снятие", async () => {
    const user = await login();
    await app.inject({
      ...json("POST", "/payments/create", user),
      payload: { mcNick: "RefundNickOne" },
    });
    const paymentId = (
      await store.listUserPayments(user.userId, 10)
    )[0]!.id;
    await app.inject({
      method: "POST",
      url: "/payments/webhook",
      payload: {
        object: { id: "yp_ref_1", status: "succeeded", metadata: { paymentId } },
      },
    });
    const jobsBefore = jobs.remove.length;
    const res = await app.inject({
      ...json("POST", `/admin/payments/${paymentId}/refund`, admin),
      payload: { reason: "Тестовый возврат" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment.status).toBe("REFUNDED");
    expect(refunds).toHaveLength(1);
    expect(jobs.remove.length).toBe(jobsBefore + 1);
  });

  it("возврат неоплаченного → 409", async () => {
    const user = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", user),
      payload: { mcNick: "RefundNickTwo" },
    });
    const res = await app.inject({
      ...json("POST", `/admin/payments/${created.json().paymentId}/refund`, admin),
      payload: { reason: "Причина возврата" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CONFLICT");
  });

  it("возврат без причины → 400", async () => {
    const user = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", user),
      payload: { mcNick: "RefundNickThree" },
    });
    const res = await app.inject({
      ...json("POST", `/admin/payments/${created.json().paymentId}/refund`, admin),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("возврат Stars: полный проходит (starsRefund), частичный → 409", async () => {
    const user = await login();
    const inv = await app.inject({
      ...json("POST", "/payments/stars/invoice", user),
      payload: { mcNick: "StarsRefundNick" },
    });
    const paymentId = inv.json().paymentId;
    await app.inject({
      ...json("POST", "/payments/stars", user),
      payload: {
        paymentId,
        telegramPaymentChargeId: "chg_refund_1",
        starsAmount: inv.json().stars,
      },
    });

    const starsBefore = starsRefunds.length;
    const partial = await app.inject({
      ...json("POST", `/admin/payments/${paymentId}/refund`, admin),
      payload: { reason: "Частичный возврат", amount: 10_000 },
    });
    expect(partial.statusCode).toBe(409);
    expect(starsRefunds.length).toBe(starsBefore);

    const full = await app.inject({
      ...json("POST", `/admin/payments/${paymentId}/refund`, admin),
      payload: { reason: "Полный возврат Stars" },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json().payment.status).toBe("REFUNDED");
    expect(starsRefunds.length).toBe(starsBefore + 1);
    expect(starsRefunds[starsBefore]).toEqual({
      tgId: String(user.tgId),
      chargeId: "chg_refund_1",
    });
  });

  it("manual settle: платёж подтверждён, игроку ушло уведомление", async () => {
    const user = await login();
    await app.inject({
      ...json("POST", "/payments/create", user),
      payload: { mcNick: "ManualSettleNick" },
    });
    const paymentId = (await store.listUserPayments(user.userId, 10))[0]!.id;
    const tgBefore = tgSent.length;
    const res = await app.inject({
      ...json("POST", `/admin/payments/${paymentId}/settle`, admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect((await store.getPaymentById(paymentId))?.status).toBe("PAID");
    expect(tgSent.length).toBeGreaterThan(tgBefore);
  });

  it("игроки: список, поиск, бан и разбан", async () => {
    const s = await login();
    await app.inject({ ...json("POST", "/me/nick", s), payload: { mcNick: "BanVictimNick" } });

    const list = await app.inject({ ...json("GET", "/admin/players", admin) });
    expect(list.statusCode).toBe(200);
    expect((list.json().players as unknown[]).length).toBeGreaterThan(0);

    const search = await app.inject({
      ...json("GET", "/admin/players?search=banvictim", admin),
    });
    expect(search.json().players).toHaveLength(1);

    const ban = await app.inject({
      ...json("POST", "/admin/players/ban", admin),
      payload: { nick: "BanVictimNick", reason: "нарушение правил" },
    });
    expect(ban.statusCode).toBe(200);
    expect(ban.json().player.status).toBe("BANNED");

    const again = await app.inject({
      ...json("POST", "/admin/players/ban", admin),
      payload: { nick: "BanVictimNick", reason: "повторный бан" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().player.banReason).toBe("повторный бан");

    const noReason = await app.inject({
      ...json("POST", "/admin/players/ban", admin),
      payload: { nick: "BanVictimNick", reason: "ab" },
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error).toBe("VALIDATION");

    const unbanned = await app.inject({
      ...json("POST", "/admin/players/unban", admin),
      payload: { nick: "BanVictimNick" },
    });
    expect(unbanned.statusCode).toBe(200);
    expect(unbanned.json().player.status).not.toBe("BANNED");
  });

  it("nick-check: валидный / занятый / невалидный", async () => {
    const ok = await app.inject({ ...json("GET", "/admin/nick-check?nick=FreeNickQ", admin) });
    expect(ok.json()).toMatchObject({ valid: true, taken: false });

    const taken = await app.inject({
      ...json("GET", "/admin/nick-check?nick=BanVictimNick", admin),
    });
    expect(taken.json()).toMatchObject({ valid: true, taken: true });

    const bad = await app.inject({ ...json("GET", "/admin/nick-check?nick=x", admin) });
    expect(bad.json()).toMatchObject({ valid: false, taken: false });
  });

  it("тикеты: список и резолв с экранированием note", async () => {
    const user = await login();
    const created = await app.inject({
      ...json("POST", "/me/tickets", user),
      payload: { type: "REFUND_REQUEST", text: "Хочу вернуть деньги <b>срочно</b>" },
    });
    const ticketId = created.json().id;

    const list = await app.inject({ ...json("GET", "/admin/tickets", admin) });
    expect(list.statusCode).toBe(200);
    expect(
      (list.json().tickets as Array<{ id: string }>).some((t) => t.id === ticketId)
    ).toBe(true);

    const tgBefore = tgSent.length;
    const resolve = await app.inject({
      ...json("POST", `/admin/tickets/${ticketId}/resolve`, admin),
      payload: { status: "APPROVED", note: "ok & <всё> хорошо" },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().ticket.status).toBe("APPROVED");
    const newMsgs = tgSent.slice(tgBefore);
    expect(newMsgs.some((m) => m.text.includes("&amp;") && m.text.includes("&lt;"))).toBe(true);
  });

  it("резолв несуществующего тикета → 404", async () => {
    const res = await app.inject({
      ...json("POST", "/admin/tickets/nope/resolve", admin),
      payload: { status: "CLOSED" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("заявки на смену ника: approve и reject", async () => {
    const user = await login();
    await app.inject({ ...json("POST", "/me/nick", user), payload: { mcNick: "NickReqOld" } });
    const req = await app.inject({
      ...json("POST", "/me/nick-request", user),
      payload: { newNick: "NickReqNew" },
    });
    expect(req.statusCode).toBe(201);
    const reqId = req.json().id;

    const list = await app.inject({ ...json("GET", "/admin/nick-requests", admin) });
    expect(
      (list.json().requests as Array<{ id: string }>).some((r) => r.id === reqId)
    ).toBe(true);

    const approved = await app.inject({
      ...json("POST", `/admin/nick-requests/${reqId}/approve`, admin),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().newNick).toBe("NickReqNew");

    const twice = await app.inject({
      ...json("POST", `/admin/nick-requests/${reqId}/approve`, admin),
    });
    expect(twice.statusCode).toBe(409);

    // вторая заявка — reject
    const req2 = await app.inject({
      ...json("POST", "/me/nick-request", user),
      payload: { newNick: "NickReqNewTwo" },
    });
    const rejected = await app.inject({
      ...json("POST", `/admin/nick-requests/${req2.json().id}/reject`, admin),
      payload: { note: "нет" },
    });
    expect(rejected.statusCode).toBe(200);
  });

  it("broadcast: уведомление активным игрокам, текст доходит", async () => {
    const before = notifierSpy.broadcasts.length;
    const res = await app.inject({
      ...json("POST", "/admin/broadcast", admin),
      payload: { text: "Привет, сервер скоро откроется!", target: "ALL" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok ?? true).toBeTruthy();
    expect(notifierSpy.broadcasts.length).toBeGreaterThan(before);
    expect(
      notifierSpy.broadcasts.some((b) => b.html.includes("сервер скоро откроется"))
    ).toBe(true);
    expect(res.json().sent).toBeGreaterThan(0);
  });

  it("broadcast: пустой текст → 400", async () => {
    const res = await app.inject({
      ...json("POST", "/admin/broadcast", admin),
      payload: { text: "", target: "ALL" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("whitelist-log и audit отвечают массивами", async () => {
    const wl = await app.inject({ ...json("GET", "/admin/whitelist-log", admin) });
    expect(wl.statusCode).toBe(200);
    expect(Array.isArray(wl.json().log)).toBe(true);
    const audit = await app.inject({ ...json("GET", "/admin/audit", admin) });
    expect(Array.isArray(audit.json().audit)).toBe(true);
  });
});

describe("стресс: параллельные запросы", () => {
  beforeAll(async () => {
    await ensureSeason();
  });

  it("50 параллельных /me → все 200", async () => {
    const s = await login();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => app.inject({ ...json("GET", "/me", s) }))
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it("30 параллельных /public/season → все 200", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => app.inject({ method: "GET", url: "/public/season" }))
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it("10 параллельных вебхуков на один платёж → ровно одна выдача", async () => {
    const s = await login();
    const created = await app.inject({
      ...json("POST", "/payments/create", s),
      payload: { mcNick: "StressHookNick" },
    });
    expect(created.statusCode).toBe(200);
    const paymentId = created.json().paymentId;
    expect(paymentId).toBeTruthy();
    expect((await store.getPaymentById(paymentId))?.status).toBe("PENDING");
    const jobsBefore = jobs.add.length;
    const payload = {
      object: {
        id: "yp_stress_1",
        status: "succeeded",
        metadata: { paymentId },
      },
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: "POST", url: "/payments/webhook", payload })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(jobs.add.length).toBe(jobsBefore + 1);
    expect((await store.getPaymentById(paymentId))?.status).toBe("PAID");
  });

  it("5 параллельных confirm одного Stars-платежа → одна выдача", async () => {
    const s = await login();
    const inv = await app.inject({
      ...json("POST", "/payments/stars/invoice", s),
      payload: { mcNick: "StressStarsNick" },
    });
    const paymentId = inv.json().paymentId;
    const stars = inv.json().stars;
    const jobsBefore = jobs.add.length;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          ...json("POST", "/payments/stars", s),
          payload: {
            paymentId,
            telegramPaymentChargeId: "chg_stress_1",
            starsAmount: stars,
          },
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(jobs.add.length).toBe(jobsBefore + 1);
  });
});
