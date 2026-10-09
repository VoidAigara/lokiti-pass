import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken, hashToken } from "../lib/jwt.js";
import { prismaStore } from "../services/store-prisma.js";
import type { UserRec } from "../services/types.js";

export interface AuthContext {
  user: UserRec;
  session: { id: string; userId: string; expiresAt: Date };
  token: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * IP клиента.
 * Fastify сам вычисляет req.ip из X-Forwarded-For, но ТОЛЬКО для доверенных
 * прокси (trustProxy в app.ts, список — TRUSTED_PROXIES). Пустой список ⇒
 * X-Forwarded-For игнорируется и подделать IP через заголовок нельзя.
 */
export function getClientIp(req: FastifyRequest): string {
  return req.ip;
}

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  const cookie = req.headers.cookie;
  if (cookie) {
    const m = /(?:^|;\s*)loki_token=([^;]+)/.exec(cookie);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }

  // Токен в query не принимаем: он утекает в логи/Referer/history.
  return null;
}

/** preHandler: обязательная авторизация (JWT + живая сессия). */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    await reply.code(401).send({
      error: "UNAUTHORIZED",
      message: "Требуется авторизация через Telegram.",
    });
    return;
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    await reply.code(401).send({
      error: "UNAUTHORIZED",
      message: "Сессия истекла. Открой кабинет заново.",
    });
    return;
  }

  const session = await prismaStore.findSessionByHash(hashToken(token));
  if (!session || session.expiresAt.getTime() < Date.now()) {
    await reply.code(401).send({
      error: "UNAUTHORIZED",
      message: "Сессия отозвана. Открой кабинет заново.",
    });
    return;
  }

  const user = await prismaStore.getUserById(session.userId);
  if (!user) {
    await reply.code(401).send({ error: "UNAUTHORIZED", message: "Пользователь не найден." });
    return;
  }
  if (user.isBanned) {
    await reply.code(403).send({ error: "FORBIDDEN", message: "Аккаунт заблокирован." });
    return;
  }

  req.auth = { user, session, token };
}
