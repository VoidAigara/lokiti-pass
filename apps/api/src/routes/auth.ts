import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateTelegramInitData } from "@loki/shared/telegram-auth";
import { env, adminTgIds, isProd } from "../config.js";
import { hashToken, signAccessToken, JWT_TTL_SECONDS } from "../lib/jwt.js";
import { isInternalTokenValid } from "../lib/internal.js";
import { prismaStore } from "../services/store-prisma.js";
import { getClientIp, requireAuth } from "../plugins/auth.js";

const WebAppBody = z.object({
  initData: z.string().min(10),
  startParam: z.string().optional(),
});

const CookieName = "loki_token";

const BotSessionBody = z.object({
  tgId: z.string().regex(/^\d{1,20}$/),
  firstName: z.string().max(128).optional().nullable(),
  tgUsername: z.string().max(64).optional().nullable(),
  lastName: z.string().max(128).optional().nullable(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Выдача JWT боту (server-to-server).
   * Защищена заголовком x-internal-token — бот «входит» от имени юзера,
   * чтобы переиспользовать те же роуты /me, /payments/*, /admin/*.
   */
  app.post(
    "/auth/bot-session",
    // брутфорус внутреннего токена: жёсткий лимит по IP
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!isInternalTokenValid(req.headers["x-internal-token"])) {
        reply.code(403).send({ error: "FORBIDDEN", message: "internal token mismatch" });
        return;
      }

      const body = BotSessionBody.parse(req.body);
      const tgIdNum = Number(body.tgId);
      const user = await prismaStore.upsertUser({
        tgId: body.tgId,
        tgUsername: body.tgUsername ?? null,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        isAdmin: adminTgIds.has(tgIdNum),
      });

      const token = await signAccessToken({
        sub: user.id,
        tgId: user.tgId,
        isAdmin: user.isAdmin,
        sid: crypto.randomUUID(),
      });

      await prismaStore.createSession({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + JWT_TTL_SECONDS * 1000),
        userAgent: "telegram-bot",
        ip: getClientIp(req),
      });

      reply.send({ token, user });
    }
  );
  /**
   * Вход через Telegram WebApp initData.
   * Проверяем HMAC, создаём/обновляем пользователя, выдаём JWT + сессию.
   */
  app.post("/auth/webapp", async (req, reply) => {
    const { initData, startParam } = WebAppBody.parse(req.body);

    const parsed = validateTelegramInitData(initData, env.BOT_TOKEN, 3600);
    if (!parsed?.user?.id) {
      reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Не удалось проверить данные Telegram. Открой страницу через бота.",
      });
      return;
    }

    const tgId = String(parsed.user.id);
    const isAdmin = adminTgIds.has(parsed.user.id);

    const user = await prismaStore.upsertUser({
      tgId,
      tgUsername: parsed.user.username ?? null,
      firstName: parsed.user.first_name ?? null,
      lastName: parsed.user.last_name ?? null,
      isAdmin,
    });

    if (user.isBanned) {
      reply.code(403).send({ error: "FORBIDDEN", message: "Аккаунт заблокирован." });
      return;
    }

    const ttlMs = JWT_TTL_SECONDS * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const token = await signAccessToken({
      sub: user.id,
      tgId,
      isAdmin: user.isAdmin,
      sid: crypto.randomUUID(),
    });

    await prismaStore.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200),
      ip: getClientIp(req),
    });

    reply
      .setCookie(CookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
        maxAge: JWT_TTL_SECONDS,
      })
      .send({
        token,
        user: {
          id: user.id,
          tgId: user.tgId,
          tgUsername: user.tgUsername,
          firstName: user.firstName,
          isAdmin: user.isAdmin,
        },
        startParam: startParam ?? null,
      });
  });

  app.post("/auth/logout", { preHandler: [requireAuth] }, async (req, reply) => {
    if (req.auth) {
      await prismaStore.deleteSession(req.auth.session.id);
    }
    reply.clearCookie(CookieName, { path: "/" }).send({ ok: true });
  });

  app.get("/auth/me", { preHandler: [requireAuth] }, async (req, reply) => {
    reply.send({ user: req.auth!.user });
  });
}
