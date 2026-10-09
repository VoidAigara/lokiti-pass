import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Интеграционные тесты prismaStore против реального PostgreSQL.
// Схема:
//   * Postgres должен быть доступен на 127.0.0.1:5433 (docker-compose, localhost-only);
//   * создаётся отдельная БД lokipass_test, на неё накатываются миграции;
//   * перед каждым тестом все таблицы обрезаются;
//   * если порт недоступен — весь suite скипается (не ломает окружение без Docker).
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB_PKG = join(ROOT, "packages", "db");

const PG_HOST = "127.0.0.1";
const PG_PORT = 5433;
const TEST_DB = "lokipass_test";
const PG_USER = process.env.POSTGRES_USER ?? "loki";
const PG_PASS = process.env.POSTGRES_PASSWORD ?? "lokipass-local";
const PG_ADMIN_DB = process.env.POSTGRES_DB ?? "lokipass";
const ADMIN_DSN = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_ADMIN_DB}`;
const TEST_DSN = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${TEST_DB}`;

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

type StoreModule = typeof import("../src/services/store-prisma.js");
type DbModule = typeof import("@loki/db");

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: PG_HOST, port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.setTimeout(2000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

const available = await probe(PG_PORT);

let store: StoreModule["prismaStore"];
let prisma: DbModule["prisma"];

function prismaCli(args: string, env: Record<string, string>, input?: string): void {
  execSync(`npx prisma ${args}`, {
    cwd: DB_PKG,
    shell: true,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    input,
  });
}

async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'"
  );
  if (rows.length > 0) {
    const list = rows.map((r) => `public."${r.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
  }
}

// ------------------------------- фикстуры ----------------------------------

let seq = 0;
const uid = (): string => `${Date.now()}_${++seq}`;
const tgIdNext = (): string => String(8_800_000_000 + ++seq);

async function makeUser(extra: Partial<Parameters<StoreModule["prismaStore"]["upsertUser"]>[0]> = {}) {
  return store.upsertUser({ tgId: tgIdNext(), ...extra });
}

async function makeSeason(opts: { activate?: boolean; number?: number } = {}) {
  return store.createSeason({
    number: opts.number ?? 90_000 + seq,
    name: `Сезон ${seq}`,
    priceNew: 500,
    priceRenew: 200,
    activate: opts.activate,
  });
}

async function makePlayer(userId: string) {
  const nick = `Nick_${uid()}`;
  return store.createPlayer({ userId, mcNick: nick, mcNickLower: nick.toLowerCase() });
}

async function makePayment(
  userId: string,
  seasonId: string,
  amount = 500,
  type: "NEW" | "RENEW" | "TOPUP" = "NEW"
) {
  return store.createPayment({
    userId,
    seasonId,
    playerId: null,
    amount,
    type,
    provider: "YOOKASSA",
    description: "test",
    idempotencyKey: uid(),
  });
}

describe.runIf(available)("prismaStore: интеграционные тесты (Postgres)", () => {
  beforeAll(async () => {
    try {
      prismaCli(`db execute --stdin --url "${ADMIN_DSN}"`, {}, `CREATE DATABASE ${TEST_DB};`);
    } catch (e) {
      if (!/already exists/i.test(String(e))) throw e;
    }

    prismaCli("migrate deploy", { DATABASE_URL: TEST_DSN });

    // DATABASE_URL выставляется ДО загрузки @loki/db (синглтон prisma).
    process.env.DATABASE_URL = TEST_DSN;
    const db = await import("@loki/db");
    const mod = await import("../src/services/store-prisma.js");
    prisma = db.prisma;
    store = mod.prismaStore;
  }, 60_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (ORIGINAL_DATABASE_URL !== undefined) {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe("users и sessions", () => {
    it("upsertUser создаёт пользователя и отдаёт tgId строкой", async () => {
      const tg = tgIdNext();
      const created = await store.upsertUser({
        tgId: tg,
        tgUsername: "loki_fan",
        firstName: "Локи",
        lastName: "Тестов",
      });
      expect(created.tgId).toBe(tg);
      expect(typeof created.tgId).toBe("string");
      expect(created.isAdmin).toBe(false);
      expect(created.isBanned).toBe(false);

      const byTg = await store.findUserByTgId(tg);
      expect(byTg?.id).toBe(created.id);
      expect(byTg?.tgUsername).toBe("loki_fan");

      const byId = await store.getUserById(created.id);
      expect(byId?.firstName).toBe("Локи");
    });

    it("повторный upsert обновляет поля, но не сбрасывает isAdmin", async () => {
      const tg = tgIdNext();
      const first = await store.upsertUser({ tgId: tg, tgUsername: "old", isAdmin: true });
      const second = await store.upsertUser({ tgId: tg, tgUsername: "new" });
      expect(second.id).toBe(first.id);
      expect(second.tgUsername).toBe("new");
      expect(second.isAdmin).toBe(true);
    });

    it("несуществующие пользователь и сессия → null", async () => {
      expect(await store.findUserByTgId(tgIdNext())).toBeNull();
      expect(await store.getUserById("no_such_user")).toBeNull();
      expect(await store.findSessionByHash("no_such_hash")).toBeNull();
    });

    it("сессия: создание, поиск по хешу, удаление", async () => {
      const user = await makeUser();
      const expiresAt = new Date(Date.now() + 86_400_000);
      const hash = uid();
      const session = await store.createSession({
        userId: user.id,
        tokenHash: hash,
        expiresAt,
        userAgent: "vitest",
        ip: "127.0.0.1",
      });
      const found = await store.findSessionByHash(hash);
      expect(found?.id).toBe(session.id);
      expect(found?.userId).toBe(user.id);
      expect(found?.expiresAt.getTime()).toBe(expiresAt.getTime());

      await store.deleteSession(session.id);
      expect(await store.findSessionByHash(hash)).toBeNull();
    });
  });

  describe("сезоны", () => {
    it("создание, активация, активный сезон = наибольший number", async () => {
      const a = await makeSeason({ number: 91_001 });
      const b = await makeSeason({ number: 91_002, activate: true });
      expect(a.isActive).toBe(false);
      expect(b.isActive).toBe(true);

      const active = await store.getActiveSeason();
      expect(active?.id).toBe(b.id);

      expect(await store.getSeasonById(a.id)).toMatchObject({ number: 91_001 });
      const list = await store.listSeasons();
      expect(list[0].number).toBeGreaterThanOrEqual(list[1].number);
    });

    it("deactivateAll / activate / close / updateSeason", async () => {
      const s = await makeSeason({ activate: true });
      await store.deactivateAllSeasons();
      expect(await store.getActiveSeason()).toBeNull();

      await store.activateSeason(s.id);
      expect((await store.getActiveSeason())?.id).toBe(s.id);

      await store.closeSeason(s.id);
      const closed = await store.getSeasonById(s.id);
      expect(closed?.isActive).toBe(false);
      expect(closed?.endedAt).not.toBeNull();

      const updated = await store.updateSeason(s.id, { priceNew: 750, name: "Новое имя" });
      expect(updated.priceNew).toBe(750);
      expect(updated.name).toBe("Новое имя");
    });
  });

  describe("игроки", () => {
    it("createPlayer и поиск по nickLower / userId / id", async () => {
      const user = await makeUser();
      const p = await makePlayer(user.id);
      expect(p.status).toBe("PENDING");

      expect((await store.getPlayerByNickLower(p.mcNickLower))?.id).toBe(p.id);
      expect((await store.getPlayerByUserId(user.id))?.id).toBe(p.id);
      expect((await store.getPlayerById(p.id))?.mcNick).toBe(p.mcNick);

      const upd = await store.updatePlayer(p.id, { status: "ACTIVE", totalPaid: 500 });
      expect(upd.status).toBe("ACTIVE");
      expect(upd.totalPaid).toBe(500);
    });

    it("listActiveNickNames не включает BANNED", async () => {
      const user = await makeUser();
      const active = await store.createPlayer({
        userId: user.id,
        mcNick: `A_${uid()}`,
        mcNickLower: `a_${seq}`,
        status: "ACTIVE",
      });
      const banned = await store.createPlayer({
        userId: user.id,
        mcNick: `B_${uid()}`,
        mcNickLower: `b_${seq}`,
        status: "BANNED",
      });
      const names = await store.listActiveNickNames();
      const lowers = names.map((n) => n.mcNickLower);
      expect(lowers).toContain(active.mcNickLower);
      expect(lowers).not.toContain(banned.mcNickLower);
      expect(names.find((n) => n.mcNickLower === active.mcNickLower)?.userId).toBe(user.id);
    });

    it("countPlayersByStatus считает по статусу", async () => {
      const user = await makeUser();
      const before = await store.countPlayersByStatus("ACTIVE");
      await store.createPlayer({
        userId: user.id,
        mcNick: `C_${uid()}`,
        mcNickLower: `c_${seq}`,
        status: "ACTIVE",
      });
      expect(await store.countPlayersByStatus("ACTIVE")).toBe(before + 1);
    });
  });

  describe("платежи", () => {
    it("createPayment: дефолты RUB/PENDING и поиск по id", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const pay = await makePayment(user.id, season.id);
      expect(pay.currency).toBe("RUB");
      expect(pay.status).toBe("PENDING");
      expect(pay.paidAt).toBeNull();

      expect((await store.getPaymentById(pay.id))?.amount).toBe(500);
      expect(await store.getPaymentByProviderId("nonexistent")).toBeNull();
    });

    it("markPaymentPaid: первая отметка firstTime=true, повторная=false", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const pay = await makePayment(user.id, season.id);

      const first = await store.markPaymentPaid(pay.id, { providerPaymentId: `prov_${uid()}` });
      expect(first.firstTime).toBe(true);
      expect(first.payment.status).toBe("PAID");
      expect(first.payment.paidAt).not.toBeNull();
      expect(await store.getPaymentByProviderId(first.payment.providerPaymentId!)).not.toBeNull();

      const second = await store.markPaymentPaid(pay.id, {});
      expect(second.firstTime).toBe(false);
      expect(second.payment.status).toBe("PAID");
    });

    it("listUserPayments и listPayments c фильтром и лимитом", async () => {
      const user = await makeUser();
      const other = await makeUser();
      const season = await makeSeason();
      const p1 = await makePayment(user.id, season.id, 100);
      const p2 = await makePayment(user.id, season.id, 200);
      await makePayment(other.id, season.id, 300);

      const mine = await store.listUserPayments(user.id);
      expect(mine).toHaveLength(2);
      const mineIds = mine.map((p) => p.id);
      expect(mineIds).toContain(p1.id);
      expect(mineIds).toContain(p2.id);
      const otherPayments = await store.listUserPayments(other.id);
      expect(otherPayments.map((p) => p.id)).not.toContain(p1.id);

      await store.markPaymentPaid(p1.id, {});
      const paid = await store.listPayments({ status: "PAID" });
      expect(paid.map((p) => p.id)).toContain(p1.id);
      expect(paid.map((p) => p.id)).not.toContain(p2.id);

      expect(await store.listPayments({ limit: 1 })).toHaveLength(1);
    });

    it("статистика: countPaymentsByStatus / sumPaidAmount / countPaid / countPaidByType", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const p1 = await makePayment(user.id, season.id, 500, "NEW");
      const p2 = await makePayment(user.id, season.id, 200, "RENEW");

      await store.markPaymentPaid(p1.id, {});
      await store.markPaymentPaid(p2.id, {});

      expect(await store.countPaymentsByStatus("PAID")).toBe(2);
      expect(await store.countPaymentsByStatus("PENDING")).toBe(0);
      expect(await store.sumPaidAmount(season.id)).toBe(700);
      expect(await store.countPaid(season.id)).toBe(2);
      expect(await store.countPaidByType("NEW", season.id)).toBe(1);
      expect(await store.countPaidByType("RENEW", season.id)).toBe(1);
      expect(await store.countPaidByType("TOPUP", season.id)).toBe(0);
    });
  });

  describe("доступ (grant/revoke) и whitelist-лог", () => {
    it("grantAccess выдаёт доступ, идемпотентен по upsert, считает продления", async () => {
      const user = await makeUser();
      const season = await makeSeason({ activate: true });
      const player = await makePlayer(user.id);

      await store.grantAccess({ playerId: player.id, seasonId: season.id, amount: 500, isRenewal: false });
      let p = await store.getPlayerById(player.id);
      expect(p?.status).toBe("ACTIVE");
      expect(p?.currentSeasonId).toBe(season.id);
      expect(p?.lastPaidAt).not.toBeNull();
      expect(p?.renewalCount).toBe(0);
      expect(await store.countPaidSeasons(player.id)).toBe(1);

      // повторный grant того же сезона — не создаёт дублей и режет продлением
      await store.grantAccess({ playerId: player.id, seasonId: season.id, amount: 200, isRenewal: true });
      p = await store.getPlayerById(player.id);
      expect(p?.renewalCount).toBe(1);
      expect(await store.countPaidSeasons(player.id)).toBe(1);
    });

    it("revokeAccess закрывает сезон, но оставляет игрока ACTIVE, пока есть другой сезон", async () => {
      const user = await makeUser();
      const s1 = await makeSeason({ number: 92_001 });
      const s2 = await makeSeason({ number: 92_002 });
      const player = await makePlayer(user.id);

      await store.grantAccess({ playerId: player.id, seasonId: s1.id, amount: 500, isRenewal: false });
      await store.grantAccess({ playerId: player.id, seasonId: s2.id, amount: 500, isRenewal: false });
      expect(await store.countPaidSeasons(player.id)).toBe(2);

      await store.revokeAccess({ playerId: player.id, seasonId: s1.id });
      const p = await store.getPlayerById(player.id);
      expect(p?.status).toBe("ACTIVE");
      expect(p?.currentSeasonId).toBe(s2.id);
      expect(await store.countPaidSeasons(player.id)).toBe(2);
    });

    it("revokeAccess последнего сезона переводит игрока в EXPIRED", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const player = await makePlayer(user.id);
      await store.grantAccess({ playerId: player.id, seasonId: season.id, amount: 500, isRenewal: false });

      await store.revokeAccess({ playerId: player.id, seasonId: season.id });
      const p = await store.getPlayerById(player.id);
      expect(p?.status).toBe("EXPIRED");
      expect(p?.currentSeasonId).toBeNull();
    });

    it("revokeAccess без seasonId отзывает все сезоны сразу", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const player = await makePlayer(user.id);
      await store.grantAccess({ playerId: player.id, seasonId: season.id, amount: 500, isRenewal: false });

      await store.revokeAccess({ playerId: player.id, seasonId: null });
      const p = await store.getPlayerById(player.id);
      expect(p?.status).toBe("EXPIRED");
      expect(p?.currentSeasonId).toBeNull();
    });

    it("whitelist-лог: идемпотентность по платежу и лента", async () => {
      const user = await makeUser();
      const season = await makeSeason();
      const payment = await makePayment(user.id, season.id);

      expect(await store.hasWhitelistLogForPayment(payment.id)).toBe(false);
      await store.createWhitelistLog({
        mcNick: "Loki",
        mcNickLower: "loki",
        action: "ADD",
        actor: "BOT",
        seasonId: season.id,
        paymentId: payment.id,
        note: "первичная выдача",
      });
      expect(await store.hasWhitelistLogForPayment(payment.id)).toBe(true);

      const log = await store.listWhitelistLog(10);
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("ADD");
      expect(log[0].actor).toBe("BOT");
      expect(await store.hasWhitelistLogForPayment("no_such_payment")).toBe(false);
    });
  });

  describe("тикеты и смена ника", () => {
    it("тикет: JSON-payload переживает round-trip, фильтры и обновление", async () => {
      const user = await makeUser();
      const other = await makeUser();
      const payload = { text: "Не приходит письмо", tags: ["login", "mail"], meta: { attempt: 2 } };

      const t = await store.createTicket({ userId: user.id, type: "SUPPORT", payload });
      expect(t.status).toBe("OPEN");
      expect(t.payload).toEqual(payload);

      const byId = await store.getTicket(t.id);
      expect(byId?.payload).toEqual(payload);

      await store.createTicket({ userId: other.id, type: "SUPPORT", payload: { text: "другой" } });
      const forUser = await store.listTickets(undefined, user.id);
      expect(forUser).toHaveLength(1);
      expect(forUser[0].id).toBe(t.id);

      const resolvedAt = new Date();
      const updated = await store.updateTicket(t.id, {
        status: "CLOSED",
        resolutionNote: "решено",
        resolvedAt,
      });
      expect(updated.status).toBe("CLOSED");
      expect(updated.resolutionNote).toBe("решено");

      const closed = await store.listTickets("CLOSED");
      expect(closed.map((x) => x.id)).toContain(t.id);

      const details = await store.listTicketDetails("CLOSED");
      const mine = details.find((d) => d.id === t.id);
      expect(mine?.user.tgId).toBe(user.tgId);
      expect(mine?.user.tgUsername).toBe(user.tgUsername);
    });

    it("nick-requests: создание, фильтр по статусу, детали и обновление", async () => {
      const user = await makeUser();
      const n = await store.createNickRequest({
        userId: user.id,
        oldNick: "OldNick",
        newNick: `New_${uid()}`,
        newNickLower: `new_${seq}`,
        reason: "хочу красивее",
      });
      expect(n.status).toBe("OPEN");
      expect(await store.getNickRequest(n.id)).toMatchObject({ oldNick: "OldNick" });

      const open = await store.listNickRequests("OPEN");
      expect(open.map((x) => x.id)).toContain(n.id);

      const updated = await store.updateNickRequest(n.id, {
        status: "APPROVED",
        note: "ок",
        resolvedAt: new Date(),
      });
      expect(updated.status).toBe("APPROVED");
      expect(updated.note).toBe("ок");

      const details = await store.listNickRequestDetails("APPROVED");
      const mine = details.find((d) => d.id === n.id);
      expect(mine?.user.firstName).toBe(user.firstName);
    });
  });

  describe("аудит и рассылки", () => {
    it("writeAudit: actorTgId строкой → строка, meta JSON round-trip", async () => {
      const user = await makeUser();
      await store.writeAudit({
        actorId: user.id,
        actorTgId: user.tgId,
        action: "PLAYER_BAN",
        entity: "player",
        entityId: "pl_1",
        meta: { reason: "читерство", days: 7 },
        ip: "127.0.0.1",
      });
      await store.writeAudit({
        action: "SEASON_CREATE",
        entity: "season",
        entityId: "s_1",
      });

      const log = await store.listAudit(10);
      expect(log).toHaveLength(2);
      const withActor = log.find((a) => a.action === "PLAYER_BAN");
      expect(withActor?.actorTgId).toBe(user.tgId);
      expect(withActor?.meta).toEqual({ reason: "читерство", days: 7 });
      const system = log.find((a) => a.action === "SEASON_CREATE");
      expect(system?.actorTgId).toBeNull();
      expect(system?.meta).toEqual({});
    });

    it("broadcast: создание и обновление статуса", async () => {
      const user = await makeUser();
      const b = await store.createBroadcast({ text: "Привет, игроки!", createdBy: user.id });
      expect(b.id).toBeTruthy();

      await store.updateBroadcast(b.id, { status: "DONE", sent: 2, failed: 0 });
      const row = await prisma.broadcast.findUnique({ where: { id: b.id } });
      expect(row?.status).toBe("DONE");
      expect(row?.sent).toBe(2);
    });
  });
});
