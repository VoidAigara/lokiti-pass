import { env } from "../config.js";
import type { Deps } from "../services/ports.js";
import { prismaStore } from "../services/store-prisma.js";
import { yooKassaGateway, fakeGateway } from "./gateway.js";
import { isYooKassaConfigured } from "../lib/yookassa.js";
import { logger } from "../lib/logger.js";
import { telegramNotifier } from "./notifier.js";
import { telegramStarsRefund } from "./stars.js";
import { rconBridge } from "./mc.js";
import { createBullQueueAdapter } from "../queue/queue.js";

/** Сборка зависимостей приложения (composition root). */
export function createDeps(overrides: Partial<Deps> = {}): Deps {
  const configured = isYooKassaConfigured();
  if (!configured) {
    logger.warn(
      "YooKassa не настроена (YOOKASSA_SHOP_ID/SECRET_KEY) — платёжный шлюз в DEMO-режиме: " +
        "платежи создаются локально, доступ выдаётся только по вебхуку/вручную в админке."
    );
  }

  const base: Deps = {
    store: prismaStore,
    gateway: configured ? yooKassaGateway : fakeGateway,
    queue: createBullQueueAdapter(),
    notifier: telegramNotifier,
    mc: rconBridge,
    starsRefund: telegramStarsRefund,
    serverIp: env.MC_SERVER_IP,
    webUrl: env.WEB_URL,
  };
  return { ...base, ...overrides };
}
