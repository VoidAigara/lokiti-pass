import { describe, expect, it } from "vitest";
import {
  processWhitelistAdd,
  processWhitelistRemove,
  refundPayment,
  settlePayment,
} from "../src/services/settle.js";
import type { Deps } from "../src/services/ports.js";
import { ServiceError } from "../src/services/payments.js";
import { InMemoryStore } from "./in-memory-store.js";
import type {
  PaymentRec,
  PaymentType,
  PlayerRec,
  SeasonRec,
  UserRec,
} from "../src/services/types.js";

interface Harness {
  deps: Deps;
  store: InMemoryStore;
  user: UserRec;
  season: SeasonRec;
  player: PlayerRec;
  mcAdd: string[];
  mcRemove: string[];
  jobsAdd: string[];
  jobsRemove: string[];
  notes: Record<string, { tgId: string; info: unknown }[]>;
  refunds: { providerPaymentId: string; amount?: number }[];
  starsRefunds: { tgId: string; chargeId: string }[];
}

function createHarness(
  opts: {
    paidSeasonsBefore?: boolean;
    paymentType?: PaymentType;
    starsRefundFails?: boolean;
  } = {}
): Harness {
  const store = new InMemoryStore();
  const mcAdd: string[] = [];
  const mcRemove: string[] = [];
  const jobsAdd: string[] = [];
  const jobsRemove: string[] = [];
  const refunds: { providerPaymentId: string; amount?: number }[] = [];
  const starsRefunds: { tgId: string; chargeId: string }[] = [];
  const notes: Harness["notes"] = { granted: [], refunded: [], failed: [], revoked: [] };

  const deps: Deps = {
    store,
    gateway: {
      create: async () => ({ providerPaymentId: "yp_1", confirmationUrl: "https://pay" }),
      refund: async (input) => {
        refunds.push({ providerPaymentId: input.providerPaymentId, amount: input.amount });
      },
    },
    queue: {
      enqueueAdd: async (job) => {
        jobsAdd.push(job.playerId);
      },
      enqueueRemove: async (job) => {
        jobsRemove.push(job.playerId);
      },
    },
    notifier: {
      accessGranted: async (tgId, info) => {
        notes.granted.push({ tgId, info });
      },
      accessRevoked: async (tgId, info) => {
        notes.revoked.push({ tgId, info });
      },
      paymentRefunded: async (tgId, info) => {
        notes.refunded.push({ tgId, info });
      },
      paymentFailed: async (tgId, info) => {
        notes.failed.push({ tgId, info });
      },
      broadcast: async () => undefined,
    },
    mc: {
      whitelistAdd: async (nick) => {
        mcAdd.push(nick);
        return `added ${nick}`;
      },
      whitelistRemove: async (nick) => {
        mcRemove.push(nick);
        return `removed ${nick}`;
      },
    },
    starsRefund: {
      refund: async (input) => {
        if (opts.starsRefundFails) throw new Error("Telegram API: REFUND_FAILED");
        starsRefunds.push(input);
      },
    },
    serverIp: "play.lokiti.ru",
    webUrl: "http://localhost:3000",
    now: () => new Date("2026-10-05T12:00:00.000Z"),
  };

  const user: UserRec = {
    id: "user_1",
    tgId: "111",
    tgUsername: "loki",
    firstName: "Loki",
    lastName: null,
    isAdmin: false,
    isBanned: false,
  };
  store.users.set(user.id, user);

  const season: SeasonRec = {
    id: "season_1",
    number: 5,
    name: "Сезон 5",
    isActive: true,
    priceNew: 50_000,
    priceRenew: 20_000,
    startedAt: new Date("2026-10-01"),
    endedAt: null,
  };
  store.seasons.set(season.id, season);

  const player: PlayerRec = {
    id: "player_1",
    userId: user.id,
    mcNick: "LokiTi",
    mcNickLower: "lokiti",
    status: "PENDING",
    currentSeasonId: null,
    totalPaid: 0,
    renewalCount: 0,
    firstPaidAt: null,
    lastPaidAt: null,
    banReason: null,
    bannedAt: null,
  };
  store.players.set(player.id, player);

  if (opts.paidSeasonsBefore) {
    // прошлый сезон уже был оплачен — игрок «вернулся» после вайпа
    store.seedPlayerSeason(player.id, "season_0", 50_000);
  }

  return { deps, store, user, season, player, mcAdd, mcRemove, jobsAdd, jobsRemove, notes, refunds, starsRefunds };
}

async function seedPayment(
  h: Harness,
  type: PaymentType,
  amount: number,
  provider: "YOOKASSA" | "STARS" = "YOOKASSA"
): Promise<PaymentRec> {
  return h.store.createPayment({
    userId: h.user.id,
    seasonId: h.season.id,
    playerId: h.player.id,
    amount,
    type,
    provider,
    description: `${type} pass`,
    idempotencyKey: `idem_${type}_${amount}`,
  });
}

describe("settlePayment — оплата", () => {
  it("первый вебхук переводит PENDING → PAID и ставит выдачу в очередь", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);

    const res = await settlePayment(h.deps, {
      paymentId: payment.id,
      providerPaymentId: "yp_123",
    });

    expect(res.firstTime).toBe(true);
    expect(res.payment?.status).toBe("PAID");
    expect(res.payment?.paidAt).toBeInstanceOf(Date);
    expect(res.payment?.providerPaymentId).toBe("yp_123");
    expect(h.jobsAdd).toEqual(["player_1"]);

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("PENDING");
    expect(player?.currentSeasonId).toBe(h.season.id);
    expect(player?.totalPaid).toBe(50_000);
    expect(player?.firstPaidAt).toBeInstanceOf(Date);
  });

  it("повторный вебхук идемпотентен: нет дублей выдачи", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);

    const first = await settlePayment(h.deps, { paymentId: payment.id });
    const second = await settlePayment(h.deps, { paymentId: payment.id });

    expect(first.firstTime).toBe(true);
    expect(second.firstTime).toBe(false);
    expect(h.jobsAdd).toHaveLength(1);

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.totalPaid).toBe(50_000);
  });

  it("ошибка провайдера помечает платёж FAILED и уведомляет игрока", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);

    await settlePayment(h.deps, {
      paymentId: payment.id,
      failureReason: "Отклонено банком",
    });

    const updated = await h.store.getPaymentById(payment.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.failureReason).toBe("Отклонено банком");
    expect(h.notes.failed).toHaveLength(1);
    expect(h.jobsAdd).toHaveLength(0);
  });
});

describe("processWhitelistAdd — выдача whitelist", () => {
  it("вызывает RCON, активирует игрока и пишет лог ровно один раз", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);
    await settlePayment(h.deps, { paymentId: payment.id });
    const job = {
      paymentId: payment.id,
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
    };

    const first = await processWhitelistAdd(h.deps, job);
    const second = await processWhitelistAdd(h.deps, job);

    expect(first.status).toBe("granted");
    expect(second.status).toBe("skipped");
    expect(h.mcAdd).toEqual(["LokiTi"]);

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("ACTIVE");
    expect(player?.currentSeasonId).toBe(h.season.id);

    expect(await h.store.hasWhitelistLogForPayment(payment.id)).toBe(true);
    expect(h.store.whitelistLogs.filter((l) => l.action === "ADD")).toHaveLength(1);
    expect(h.notes.granted).toHaveLength(1);
  });

  it("не выдаёт доступ по неоплаченному платежу", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);

    const res = await processWhitelistAdd(h.deps, {
      paymentId: payment.id,
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
    });

    expect(res).toEqual({ status: "skipped", reason: "payment_PENDING" });
    expect(h.mcAdd).toHaveLength(0);
  });

  it("продление после вайпа увеличивает renewalCount", async () => {
    const h = createHarness({ paidSeasonsBefore: true, paymentType: "RENEW" });
    const payment = await seedPayment(h, "RENEW", 20_000);

    await settlePayment(h.deps, { paymentId: payment.id });
    await processWhitelistAdd(h.deps, {
      paymentId: payment.id,
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
    });

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("ACTIVE");
    expect(player?.renewalCount).toBe(1);
    expect(player?.totalPaid).toBe(20_000);
  });
});

describe("processWhitelistRemove — отзыв доступа", () => {
  it("снимает ник с whitelist и пишет лог", async () => {
    const h = createHarness();
    await processWhitelistRemove(h.deps, {
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
      reason: "refund: тест",
    });

    expect(h.mcRemove).toEqual(["LokiTi"]);
    expect(h.store.whitelistLogs).toHaveLength(1);
    expect(h.store.whitelistLogs[0]?.action).toBe("REMOVE");
    expect(h.store.whitelistLogs[0]?.note).toBe("refund: тест");
  });

  it("не падает, если сервер уже не знает этот ник", async () => {
    const h = createHarness();
    h.deps.mc.whitelistRemove = async () => {
      throw new Error("Player is not whitelisted");
    };

    await expect(
      processWhitelistRemove(h.deps, {
        playerId: h.player.id,
        nick: h.player.mcNick,
        seasonId: null,
      })
    ).resolves.toBeUndefined();

    expect(h.store.whitelistLogs).toHaveLength(1);
  });
});

describe("refundPayment — возврат", () => {
  async function paidHarness(): Promise<Harness> {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);
    await settlePayment(h.deps, { paymentId: payment.id, providerPaymentId: "yp_1" });
    await processWhitelistAdd(h.deps, {
      paymentId: payment.id,
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
    });
    return h;
  }

  it("полный возврат: платёж REFUNDED, доступ отозван, аудит записан", async () => {
    const h = await paidHarness();
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    const updated = await refundPayment(h.deps, {
      paymentId: payment.id,
      reason: "Доступ не выдан вовремя",
      actorId: h.user.id,
      actorTgId: "999",
    });

    expect(updated.status).toBe("REFUNDED");
    expect(updated.refundReason).toBe("Доступ не выдан вовремя");
    expect(h.refunds[0]).toEqual({ providerPaymentId: "yp_1", amount: 50_000 });

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("EXPIRED");
    expect(player?.currentSeasonId).toBeNull();
    expect(h.store.activePlayerSeasonCount(h.player.id)).toBe(0);
    expect(h.jobsRemove).toEqual(["player_1"]);
    expect(h.notes.refunded).toHaveLength(1);

    const audits = await h.store.listAudit();
    expect(audits.some((a) => a.action.includes("REFUND"))).toBe(true);
    expect(audits[0]?.meta).toMatchObject({ full: true });
  });

  it("частичный возврат не забирает доступ", async () => {
    const h = await paidHarness();
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    const updated = await refundPayment(h.deps, {
      paymentId: payment.id,
      reason: "Частичная компенсация",
      amount: 10_000,
      actorId: h.user.id,
      actorTgId: "999",
    });

    expect(updated.status).toBe("PAID");
    expect(h.refunds[0]).toMatchObject({ amount: 10_000 });

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("ACTIVE");
    expect(h.jobsRemove).toHaveLength(0);
    expect(h.notes.refunded).toHaveLength(0);
  });

  it("нельзя вернуть неоплаченный платёж", async () => {
    const h = createHarness();
    const payment = await seedPayment(h, "NEW", 50_000);

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "причина",
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toBeInstanceOf(ServiceError);
    expect(payment.status).toBe("PENDING");
  });

  it("нельзя вернуть без причины и с суммой больше платежа", async () => {
    const h = await paidHarness();
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "аб",
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "нормальная причина",
        amount: 60_000,
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("refundPayment — Telegram Stars", () => {
  async function paidStarsHarness(
    opts: { chargeId?: string | null; fail?: boolean } = {}
  ): Promise<Harness> {
    const h = createHarness({ starsRefundFails: opts.fail });
    const payment = await seedPayment(h, "NEW", 50_000, "STARS");
    await h.store.updatePayment(payment.id, {
      providerPaymentId: opts.chargeId === undefined ? "tpc_1" : opts.chargeId,
    });
    await settlePayment(h.deps, { paymentId: payment.id });
    await processWhitelistAdd(h.deps, {
      paymentId: payment.id,
      playerId: h.player.id,
      nick: h.player.mcNick,
      seasonId: h.season.id,
    });
    return h;
  }

  it("полный возврат зовёт refundStarPayment с tgId и charge id, платёж REFUNDED", async () => {
    const h = await paidStarsHarness();
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    const updated = await refundPayment(h.deps, {
      paymentId: payment.id,
      reason: "Ошибка выдачи",
      actorId: h.user.id,
      actorTgId: "999",
    });

    expect(updated.status).toBe("REFUNDED");
    expect(h.starsRefunds).toEqual([{ tgId: "111", chargeId: "tpc_1" }]);
    // YooKassa-шлюз не трогаем
    expect(h.refunds).toHaveLength(0);

    const player = await h.store.getPlayerById(h.player.id);
    expect(player?.status).toBe("EXPIRED");
    expect(h.jobsRemove).toEqual(["player_1"]);
    expect(h.notes.refunded).toHaveLength(1);
  });

  it("частичный возврат Stars запрещён — Telegram возвращает только полную сумму", async () => {
    const h = await paidStarsHarness();
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "частичка",
        amount: 10_000,
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(h.starsRefunds).toHaveLength(0);
    const after = await h.store.getPaymentById(payment.id);
    expect(after?.status).toBe("PAID");
  });

  it("Telegram отклонил возврат — платёж остаётся PAID, ошибка PAYMENT_FAILED", async () => {
    const h = await paidStarsHarness({ fail: true });
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "тест сбоя",
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });

    expect(h.starsRefunds).toHaveLength(0);
    const after = await h.store.getPaymentById(payment.id);
    expect(after?.status).toBe("PAID");
    expect(after?.refundReason).toBeNull();
    expect(h.jobsRemove).toHaveLength(0);
  });

  it("нет charge id — возврат невозможен", async () => {
    const h = await paidStarsHarness({ chargeId: null });
    const payment = (await h.store.listUserPayments(h.user.id))[0] as PaymentRec;

    await expect(
      refundPayment(h.deps, {
        paymentId: payment.id,
        reason: "нет charge id",
        actorId: h.user.id,
        actorTgId: "999",
      })
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });

    expect(h.starsRefunds).toHaveLength(0);
  });
});
