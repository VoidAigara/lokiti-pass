import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, getClientIp } from "../plugins/auth.js";
import { env } from "../config.js";
import { prismaStore } from "../services/store-prisma.js";
import { createPlayerPayment } from "../services/payments.js";
import { settlePayment } from "../services/settle.js";
import {
  isYooKassaSourceIp,
  getYkPayment,
  isYooKassaConfigured,
} from "../lib/yookassa.js";
import { logger } from "../lib/logger.js";
import { notifyUser } from "../lib/telegram.js";
import type { Deps } from "../services/ports.js";
import { paymentToDto, seasonToDto } from "./me.js";

const CreateBody = z.object({
  mcNick: z.string().min(1).max(24).optional(),
  type: z.enum(["NEW", "RENEW"]).optional(),
});

const YkWebhook = z.object({
  type: z.string().optional(),
  event: z.string().optional(),
  object: z.object({
    id: z.string(),
    status: z.string().optional(),
    paid: z.boolean().optional(),
    amount: z
      .object({ value: z.string(), currency: z.string() })
      .optional(),
    metadata: z.record(z.string()).optional(),
    description: z.string().optional(),
  }),
});

const StarsBody = z.object({
  paymentId: z.string().min(1),
  telegramPaymentChargeId: z.string().min(1),
  /** сумма в звёздах — сверяется с суммой платежа (обязательна) */
  starsAmount: z.number().int().positive(),
});

/** Сколько звёзд должно быть списано за сумму платежа (копейки). */
function expectedStars(kopecks: number): number {
  return Math.max(1, Math.ceil(kopecks / 100 / env.STARS_RUB_PER_STAR));
}

export function paymentRoutes(deps: Deps): (app: FastifyInstance) => Promise<void> {
  return async function (app: FastifyInstance) {
    /** Создание платежа (ссылка на оплату). */
    app.post(
      "/payments/create",
      { preHandler: [requireAuth] },
      async (req, reply) => {
        const body = CreateBody.parse(req.body ?? {});
        const userId = req.auth!.user.id;

        const result = await createPlayerPayment(deps, {
          userId,
          mcNick: body.mcNick,
          forceType: body.type,
        });

        const offerSeason = result.offer.season
          ? await prismaStore.getSeasonById(result.offer.season.id)
          : null;

        reply.send({
          paymentId: result.payment.id,
          confirmationUrl: result.payment.confirmationUrl,
          reused: result.reused,
          offer: {
            kind: result.offer.kind,
            amount: result.offer.amount,
            type: result.offer.type,
            reason: result.offer.reason,
            season: offerSeason ? seasonToDto(offerSeason) : null,
          },
        });
      }
    );

    /** Статус платежа (после редиректа с оплаты). */
    app.get<{ Params: { id: string } }>(
      "/payments/:id",
      { preHandler: [requireAuth] },
      async (req, reply) => {
        const payment = await prismaStore.getPaymentById(req.params.id);
        if (!payment || payment.userId !== req.auth!.user.id) {
          reply.code(404).send({ error: "NOT_FOUND", message: "Платёж не найден." });
          return;
        }
        const seasons = new Map<string, import("../services/types.js").SeasonRec>();
        reply.send({ payment: await paymentToDto(payment, seasons) });
      }
    );

    /**
     * Webhook YooKassa.
     * 1) IP из YOOKASSA_WEBHOOK_IPS (если задан).
     * 2) Боевой режим: сверяем платёж через YooKassa GET API — status, сумма,
     *    валюта и metadata берутся из ответа провайдера, а не из payload.
     *    Ошибка связи/проверки ⇒ 502 (fail-closed, провайдер повторит).
     * 3) YooKassa не настроена ⇒ только при DEMO_WEBHOOK_TRUST=true
     *    (локальная разработка и smoke-тесты).
     */
    app.post("/payments/webhook", async (req, reply) => {
      const ip = getClientIp(req);
      if (!isYooKassaSourceIp(ip)) {
        logger.warn({ ip }, "webhook from unknown IP rejected");
        reply.code(403).send({ error: "FORBIDDEN" });
        return;
      }

      let parsed;
      try {
        parsed = YkWebhook.parse(req.body);
      } catch (err) {
        logger.warn({ err, ip }, "malformed webhook");
        reply.code(400).send({ error: "VALIDATION" });
        return;
      }

      const obj = parsed.object;
      const providerPaymentId = obj.id;

      if (!isYooKassaConfigured()) {
        if (!env.DEMO_WEBHOOK_TRUST) {
          logger.warn({ ip, providerPaymentId }, "webhook rejected: YooKassa not configured");
          reply.code(502).send({ error: "YOOKASSA_NOT_CONFIGURED" });
          return;
        }
        // demo-режим: payload — источник истины (smoke/разработка)
        const demoMeta = obj.metadata ?? {};
        try {
          if (obj.status === "canceled") {
            await settlePayment(deps, {
              providerPaymentId,
              failureReason: "Платёж отменён в ЮKassa",
            });
          } else if (obj.status === "succeeded" || obj.paid === true) {
            const { payment, firstTime } = await settlePayment(deps, {
              paymentId: demoMeta.paymentId,
              providerPaymentId,
            });
            logger.info(
              { paymentId: payment?.id, firstTime, ip },
              "webhook settled (demo)"
            );
          }
        } catch (err) {
          logger.error({ err, providerPaymentId }, "demo webhook processing failed");
          reply.code(502).send({ error: "PROCESSING_FAILED" });
          return;
        }
        reply.send({ ok: true });
        return;
      }

      // --- боевой режим: верификация через YooKassa API (fail-closed) ---
      let real;
      try {
        real = await getYkPayment(providerPaymentId);
      } catch (err) {
        logger.error(
          { err, providerPaymentId, ip },
          "webhook: YooKassa GET failed — rejected (fail-closed)"
        );
        reply.code(502).send({ error: "YK_VERIFY_FAILED" });
        return;
      }

      // авторитетный metadata — из ответа YooKassa, не из payload
      const metadata = real.metadata ?? obj.metadata ?? {};
      const payment = metadata.paymentId
        ? await prismaStore.getPaymentById(metadata.paymentId)
        : null;

      if (payment && real.amount) {
        const expectedValue = (payment.amount / 100).toFixed(2);
        if (real.amount.currency !== "RUB" || real.amount.value !== expectedValue) {
          logger.error(
            { providerPaymentId, got: real.amount, expectedValue, ip },
            "webhook amount mismatch — rejected"
          );
          reply.code(400).send({ error: "AMOUNT_MISMATCH" });
          return;
        }
      }

      try {
        if (real.status === "canceled") {
          await settlePayment(deps, {
            providerPaymentId,
            failureReason: "Платёж отменён в ЮKassa",
          });
          reply.send({ ok: true });
          return;
        }

        const confirmed = real.status === "succeeded" || real.paid === true;
        if (confirmed) {
          if (!payment && !metadata.paymentId) {
            logger.warn(
              { providerPaymentId, metadata },
              "webhook: succeeded but no paymentId in metadata"
            );
          }
          const { payment: settled, firstTime } = await settlePayment(deps, {
            paymentId: metadata.paymentId,
            providerPaymentId,
          });
          logger.info(
            { paymentId: settled?.id, firstTime, ip },
            "webhook settled"
          );
        }
        // pending / waiting_for_capture — просто подтверждаем получение
      } catch (err) {
        logger.error({ err, providerPaymentId }, "webhook processing failed");
        // 502 — YooKassa повторит при временной ошибке БД
        reply.code(502).send({ error: "PROCESSING_FAILED" });
        return;
      }

      reply.send({ ok: true });
    });

    /**
     * Подтверждение оплаты Telegram Stars.
     * Бот получает successful_payment и пересылает сюда — сумма сверяется.
     */
    app.post(
      "/payments/stars",
      { preHandler: [requireAuth] },
      async (req, reply) => {
        const body = StarsBody.parse(req.body);
        const userId = req.auth!.user.id;

        const payment = await prismaStore.getPaymentById(body.paymentId);
        if (!payment || payment.userId !== userId) {
          reply.code(404).send({ error: "NOT_FOUND", message: "Платёж не найден." });
          return;
        }
        if (payment.provider !== "STARS") {
          reply.code(409).send({
            error: "CONFLICT",
            message: "Этот платёж не создан через Telegram Stars.",
          });
          return;
        }
        if (payment.status === "PAID") {
          reply.send({ ok: true, already: true });
          return;
        }

        // сверка суммы: сколько списано звёзд должно совпасть с оффером
        const expected = expectedStars(payment.amount);
        if (body.starsAmount !== expected) {
          reply.code(400).send({
            error: "VALIDATION",
            message: `Сумма звёзд не совпала (ожидалось ${expected}).`,
          });
          return;
        }

        // charge id уже привязан к другому списанию — подделка/повтор
        if (
          payment.providerPaymentId &&
          payment.providerPaymentId !== body.telegramPaymentChargeId
        ) {
          reply.code(409).send({
            error: "CONFLICT",
            message: "Платёж уже подтверждён другим списанием.",
          });
          return;
        }

        await prismaStore.updatePayment(payment.id, {
          providerPaymentId: body.telegramPaymentChargeId,
        });

        const { firstTime } = await settlePayment(deps, {
          paymentId: payment.id,
          providerPaymentId: body.telegramPaymentChargeId,
        });

        reply.send({ ok: true, firstTime });
      }
    );

    /** Создание инвойса Stars (бот вызывает перед показом кнопки). */
    app.post(
      "/payments/stars/invoice",
      { preHandler: [requireAuth] },
      async (req, reply) => {
        if (!env.STARS_ENABLED) {
          reply.code(404).send({ error: "NOT_FOUND", message: "Stars отключены." });
          return;
        }
        const body = CreateBody.parse(req.body ?? {});
        const result = await createPlayerPayment(deps, {
          userId: req.auth!.user.id,
          mcNick: body.mcNick,
          forceType: body.type,
          provider: "STARS",
        });
        reply.send({
          paymentId: result.payment.id,
          amount: result.payment.amount,
          // эталонное число звёзд — бот ставит в инвойс именно его,
          // а при подтверждении API сверяет сумму с этим же числом
          stars: expectedStars(result.payment.amount),
          title: result.payment.description,
          payload: JSON.stringify({ paymentId: result.payment.id }),
        });
      }
    );
  };
}

/** Ручное подтверждение платежа админом (перенос из DonationAlerts и т.п.). */
export async function manualSettle(
  deps: Deps,
  paymentId: string,
  actor: { actorId: string; actorTgId: string }
): Promise<void> {
  await settlePayment(deps, {
    paymentId,
    actorId: actor.actorId,
    manual: true,
  });
  const payment = await prismaStore.getPaymentById(paymentId);
  if (payment) {
    const user = await prismaStore.getUserById(payment.userId);
    if (user) {
      await notifyUser(BigInt(user.tgId), "✅ Платёж подтверждён администратором.");
    }
  }
}
