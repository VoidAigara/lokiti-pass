import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config.js";
import { logger } from "./lib/logger.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { getClientIp } from "./plugins/auth.js";
import { isYooKassaConfigured } from "./lib/yookassa.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { paymentRoutes } from "./routes/payments.js";
import { publicRoutes } from "./routes/public.js";
import { adminCoreRoutes } from "./routes/admin.js";
import { adminPeopleRoutes } from "./routes/admin-people.js";
import type { Deps } from "./services/ports.js";
import { rconHealth } from "./adapters/mc.js";
import { pingRedis } from "./queue/queue.js";

export interface BuildAppOptions {
  deps: Deps;
  /** Отключить queue/redis health в тестах. */
  skipHealthInfra?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  // X-Forwarded-For честен только от доверенных прокси (TRUSTED_PROXIES).
  // Пусто ⇒ false: req.ip = адрес сокета, подделать его заголовком нельзя.
  const trustedProxies = env.TRUSTED_PROXIES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const app = Fastify({
    // Fastify 5: экземпляр логгера передаётся в loggerInstance,
    // а logger принимает только объект опций.
    loggerInstance: logger,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: env.NODE_ENV === "test",
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cookie, {});

  // Только свой фронт. Раньше сюда попадал regex «любой https-origin» —
  // с credentials: true это позволяло любому сайту делать кросс-доменные запросы.
  await app.register(cors, {
    origin: [env.WEB_URL],
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MIN * 2,
    timeWindow: "1 minute",
    // ключ по IP: раньше ключом был префикс Authorization — ротация
    // токена давала свежий лимит, а один IP мог душить лимиты чужих.
    keyGenerator: (req) => getClientIp(req),
  });

  if (isYooKassaConfigured() && !env.YOOKASSA_WEBHOOK_IPS.trim()) {
    logger.warn(
      "YOOKASSA_WEBHOOK_IPS пуст — IP-проверка вебхука отключена; доверяем только верификации через YooKassa API"
    );
  }
  if (env.DEMO_WEBHOOK_TRUST && !isYooKassaConfigured()) {
    logger.warn(
      "DEMO_WEBHOOK_TRUST=true: вебхуки принимаются без проверки в YooKassa (только для разработки/smoke)"
    );
  }

  registerErrorHandler(app);

  // health — без auth, для uptime-мониторинга и алертов в бота
  app.get("/health", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; message?: string }> = {};

    if (!opts.skipHealthInfra) {
      const [redis, rcon] = await Promise.all([
        pingRedis(),
        rconHealth(),
      ]);
      checks.redis = redis;
      checks.rcon = rcon;
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    reply.code(allOk ? 200 : 503).send({
      status: allOk ? "ok" : "degraded",
      uptime: process.uptime(),
      checks,
      time: new Date().toISOString(),
    });
  });

  app.get("/", async (_req, reply) => {
    reply.send({ name: "Loki Ti Pass API", version: "1.0.0" });
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(paymentRoutes(opts.deps));
  await app.register(publicRoutes);
  // админ-роуты инкапсулированы: их preHandler (adminGuard) действует только внутри
  await app.register(adminCoreRoutes(opts.deps));
  await app.register(adminPeopleRoutes(opts.deps));

  return app;
}
