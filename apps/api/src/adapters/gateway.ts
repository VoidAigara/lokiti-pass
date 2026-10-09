import { env } from "../config.js";
import type {
  GatewayCreateInput,
  GatewayCreateResult,
  PaymentGateway,
} from "../services/ports.js";
import {
  createYkPayment,
  isYooKassaConfigured,
  refundYkPayment,
} from "../lib/yookassa.js";
import { logger } from "../lib/logger.js";

/**
 * YooKassa — основной провайдер.
 * Telegram Stars обрабатывается отдельно (bot starsRawPayment → /payments/stars).
 */
export const yooKassaGateway: PaymentGateway = {
  async create(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    if (!isYooKassaConfigured()) {
      throw new Error(
        "YooKassa не настроена. Заполни YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env"
      );
    }

    const payment = await createYkPayment({
      amount: input.amount,
      description: input.description,
      returnUrl: input.returnUrl,
      metadata: input.metadata,
      idempotenceKey: input.idempotencyKey,
      receiptCustomer: input.customer,
    });

    const url = payment.confirmation?.confirmation_url ?? null;
    if (!url) {
      throw new Error(`YooKassa не вернула confirmation_url (status=${payment.status})`);
    }

    logger.info(
      { ykPaymentId: payment.id, amount: input.amount },
      "YooKassa payment created"
    );

    return { providerPaymentId: payment.id, confirmationUrl: url };
  },

  async refund(input): Promise<void> {
    const res = await refundYkPayment({
      paymentId: input.providerPaymentId,
      amount: input.amount,
      idempotenceKey: input.idempotencyKey,
    });
    logger.info({ refundId: res.id, status: res.status }, "YooKassa refund created");
  },
};

/** Заглушка для тестов / локального запуска без YooKassa. */
export const fakeGateway: PaymentGateway = {
  async create(): Promise<GatewayCreateResult> {
    return {
      providerPaymentId: `fake_${crypto.randomUUID()}`,
      confirmationUrl: `${env.WEB_URL}/profile?demo=1`,
    };
  },
  async refund(): Promise<void> {
    /* noop */
  },
};
