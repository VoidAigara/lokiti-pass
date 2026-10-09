import { AUDIT_ACTIONS } from "@loki/shared";
import type { PaymentRec } from "./types.js";
import type { Deps } from "./ports.js";
import { nowOf } from "./ports.js";
import { ServiceError } from "./payments.js";
import { logger } from "../lib/logger.js";

/**
 * Приём события «платёж оплачен / обрезан» от YooKassa или из админки.
 * firstTime=false → это повторная доставка, дополнительных действий не делаем.
 */
export async function settlePayment(
  deps: Deps,
  input: {
    paymentId?: string;
    providerPaymentId?: string;
    failureReason?: string;
    actorId?: string;
    manual?: boolean;
  }
): Promise<{ payment: PaymentRec | null; firstTime: boolean }> {
  const { store } = deps;

  const payment = input.paymentId
    ? await store.getPaymentById(input.paymentId)
    : input.providerPaymentId
      ? await store.getPaymentByProviderId(input.providerPaymentId)
      : null;

  if (!payment) return { payment: null, firstTime: false };

  if (input.failureReason) {
    if (payment.status === "PENDING") {
      await store.updatePayment(payment.id, {
        status: "FAILED",
        failureReason: input.failureReason,
      });
      const u = await store.getUserById(payment.userId);
      if (u) {
        await deps.notifier.paymentFailed(u.tgId, {
          message: input.failureReason,
        });
      }
    }
    return { payment, firstTime: false };
  }

  const { payment: paid, firstTime } = await store.markPaymentPaid(payment.id, {
    providerPaymentId: input.providerPaymentId,
    paidAt: nowOf(deps),
  });

  if (!firstTime) return { payment: paid, firstTime: false };

  if (input.actorId) {
    await store.writeAudit({
      actorId: input.actorId,
      action: AUDIT_ACTIONS.PAYMENT_MANUAL,
      entity: "Payment",
      entityId: paid.id,
      meta: { amount: paid.amount, type: paid.type },
    });
  }

  await enqueueWhitelistGrant(deps, paid);
  return { payment: paid, firstTime: true };
}

/**
 * Постановка задачи на выдачу whitelist.
 * Ставится только после того, как платёж реально PAID.
 */
export async function enqueueWhitelistGrant(
  deps: Deps,
  payment: PaymentRec
): Promise<void> {
  const { store } = deps;

  if (!payment.playerId || !payment.seasonId) {
    throw new ServiceError(
      "VALIDATION",
      `Платёж ${payment.id} без игрока или сезона — выдать доступ невозможно.`
    );
  }

  // идемпотентность: выдача уже была
  if (await store.hasWhitelistLogForPayment(payment.id)) return;

  const player = await store.getPlayerById(payment.playerId);
  if (!player) {
    throw new ServiceError("NOT_FOUND", `Игрок ${payment.playerId} не найден.`);
  }
  if (player.status === "BANNED") return;

  // статус «оплачено, ещё не выдано» — чтобы игрок видел прогресс
  if (player.status !== "ACTIVE" || player.currentSeasonId !== payment.seasonId) {
    await store.updatePlayer(player.id, {
      status: "PENDING",
      currentSeasonId: payment.seasonId,
      totalPaid: player.totalPaid + payment.amount,
      ...(player.firstPaidAt ? {} : { firstPaidAt: nowOf(deps) }),
    });
  }

  await deps.queue.enqueueAdd({
    action: "whitelist_add",
    paymentId: payment.id,
    playerId: player.id,
    nick: player.mcNick,
    seasonId: payment.seasonId,
  });
}

/**
 * Ядро джобы выдачи whitelist. Вызывается worker'ом BullMQ и напрямую в тестах.
 * Идемпотентна: повторный запуск не дублирует выдачу.
 */
export async function processWhitelistAdd(
  deps: Deps,
  payload: { paymentId: string; playerId: string; nick: string; seasonId: string }
): Promise<{ status: "granted" | "skipped"; reason?: string }> {
  const { store } = deps;

  const payment = await store.getPaymentById(payload.paymentId);
  if (!payment) return { status: "skipped", reason: "payment_not_found" };
  if (payment.status !== "PAID") {
    return { status: "skipped", reason: `payment_${payment.status}` };
  }
  if (await store.hasWhitelistLogForPayment(payload.paymentId)) {
    return { status: "skipped", reason: "already_granted" };
  }

  const player = await store.getPlayerById(payload.playerId);
  if (!player) return { status: "skipped", reason: "player_not_found" };
  if (player.status === "BANNED") {
    return { status: "skipped", reason: "player_banned" };
  }

  const season = await store.getSeasonById(payload.seasonId);
  if (!season || !season.isActive) {
    return { status: "skipped", reason: "season_closed" };
  }

  // 1) самое важное — команда серверу
  await deps.mc.whitelistAdd(payload.nick);

  // 2) фиксируем доступ в БД
  await store.grantAccess({
    playerId: player.id,
    seasonId: payload.seasonId,
    amount: payment.amount,
    isRenewal: payment.type === "RENEW",
  });

  // 3) лог для идемпотентности и аудита
  await store.createWhitelistLog({
    mcNick: player.mcNick,
    mcNickLower: player.mcNickLower,
    action: "ADD",
    actor: "SYSTEM",
    seasonId: payload.seasonId,
    paymentId: payment.id,
    note: `auto after ${payment.provider} payment`,
  });

  // 4) пуш игроку
  const user = await store.getUserById(payment.userId);
  if (user) {
    await deps.notifier.accessGranted(user.tgId, {
      nick: player.mcNick,
      seasonName: season.name,
      ip: deps.serverIp,
    });
  }

  return { status: "granted" };
}

/** Ядро джобы отзыва доступа (вайп, возврат, бан). */
export async function processWhitelistRemove(
  deps: Deps,
  payload: {
    playerId: string;
    nick: string;
    seasonId: string | null;
    reason?: string;
  }
): Promise<void> {
  const { store } = deps;
  try {
    await deps.mc.whitelistRemove(payload.nick);
  } catch (err) {
    // если сервер уже не знает этот ник — это не ошибка
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not (found|whitelisted)/i.test(msg)) throw err;
  }

  const player = await store.getPlayerById(payload.playerId);
  if (player) {
    await store.createWhitelistLog({
      mcNick: player.mcNick,
      mcNickLower: player.mcNickLower,
      action: "REMOVE",
      actor: "SYSTEM",
      seasonId: payload.seasonId,
      paymentId: null,
      note: payload.reason ?? "revoked",
    });
  }
}

export interface RefundInput {
  paymentId: string;
  reason: string;
  actorId: string;
  actorTgId: string;
  /** Полный возврат или частичный (в копейках). */
  amount?: number;
  ip?: string;
}

/**
 * Возврат. Только вручную через админку, всегда с причиной и записью в AuditLog.
 */
export async function refundPayment(
  deps: Deps,
  input: RefundInput
): Promise<PaymentRec> {
  const { store } = deps;

  const payment = await store.getPaymentById(input.paymentId);
  if (!payment) {
    throw new ServiceError("NOT_FOUND", "Платёж не найден.");
  }
  if (payment.status !== "PAID") {
    throw new ServiceError(
      "CONFLICT",
      `Возврат возможен только для оплаченных платежей (сейчас: ${payment.status}).`
    );
  }
  if (!input.reason || input.reason.trim().length < 3) {
    throw new ServiceError(
      "VALIDATION",
      "Укажи причину возврата — она попадёт в журнал."
    );
  }

  const refundAmount = input.amount ?? payment.amount;
  if (refundAmount <= 0 || refundAmount > payment.amount) {
    throw new ServiceError(
      "VALIDATION",
      "Сумма возврата должна быть больше нуля и не больше суммы платежа."
    );
  }

  if (payment.provider === "STARS") {
    // Возврат выполняет сам Telegram (refundStarPayment) — возвращаем ровно
    // полную сумму тем же ботом, что получил оплату.
    if (!payment.providerPaymentId) {
      throw new ServiceError(
        "PAYMENT_FAILED",
        "У платежа нет telegram_payment_charge_id — возврат Stars невозможен."
      );
    }
    if (refundAmount < payment.amount) {
      throw new ServiceError(
        "CONFLICT",
        "Частичный возврат Stars недоступен — Telegram возвращает только полную сумму платежа."
      );
    }
    const starsUser = await store.getUserById(payment.userId);
    if (!starsUser) {
      throw new ServiceError("NOT_FOUND", "Пользователь платежа не найден.");
    }
    try {
      await deps.starsRefund.refund({
        tgId: starsUser.tgId,
        chargeId: payment.providerPaymentId,
      });
    } catch (err) {
      logger.error(
        { err, paymentId: payment.id },
        "refundStarPayment failed"
      );
      throw new ServiceError(
        "PAYMENT_FAILED",
        "Telegram отклонил возврат Stars — платёж не изменён, попробуй позже."
      );
    }
  }

  if (payment.provider === "YOOKASSA") {
    if (payment.providerPaymentId) {
      await deps.gateway.refund({
        providerPaymentId: payment.providerPaymentId,
        amount: refundAmount,
        idempotencyKey: `refund_${payment.id}_${Date.now()}`,
      });
    } else {
      throw new ServiceError(
        "PAYMENT_FAILED",
        "У платежа нет providerPaymentId — возврат через YooKassa невозможен."
      );
    }
  }

  const isFull = refundAmount >= payment.amount;
  const updated = await store.updatePayment(payment.id, {
    status: isFull ? "REFUNDED" : payment.status,
    refundReason: input.reason,
    refundedAt: nowOf(deps),
  });

  // полный возврат → забираем доступ
  if (isFull && payment.playerId) {
    await store.revokeAccess({
      playerId: payment.playerId,
      seasonId: payment.seasonId,
    });
    const player = await store.getPlayerById(payment.playerId);
    if (player) {
      await deps.queue.enqueueRemove({
        action: "whitelist_remove",
        playerId: player.id,
        nick: player.mcNick,
        seasonId: payment.seasonId,
        reason: `refund: ${input.reason}`,
      });
    }
    const user = await store.getUserById(payment.userId);
    if (user) {
      await deps.notifier.paymentRefunded(user.tgId, {
        amount: refundAmount,
        reason: input.reason,
      });
    }
  }

  await store.writeAudit({
    actorId: input.actorId,
    actorTgId: input.actorTgId,
    action: AUDIT_ACTIONS.PAYMENT_REFUND,
    entity: "Payment",
    entityId: payment.id,
    meta: { amount: refundAmount, reason: input.reason, full: isFull },
  });

  return updated;
}
