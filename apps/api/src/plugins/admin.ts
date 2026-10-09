import type { FastifyReply, FastifyRequest } from "fastify";
import { env, adminTgIds } from "../config.js";
import { ipMatches } from "../lib/yookassa.js";
import { getClientIp, requireAuth } from "./auth.js";

/**
 * Единый guard для всех /admin/* маршрутов:
 *   1) IP allowlist (ADMIN_IP_ALLOWLIST, CIDR через запятую)
 *   2) живая JWT-сессия
 *   3) роль администратора (ADMIN_TG_IDS или users.isAdmin)
 */
export async function adminGuard(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // 1) IP
  const allow = env.ADMIN_IP_ALLOWLIST.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length > 0) {
    const ip = getClientIp(req);
    if (!allow.some((cidr) => ipMatches(ip, cidr))) {
      await reply
        .code(403)
        .send({ error: "FORBIDDEN", message: "IP не в белом списке админки." });
      return;
    }
  }

  // 2) auth (сам шлёт 401/403 и останавливает цепочку)
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.auth) return;

  // 3) роль
  const user = req.auth.user;
  const fromEnv = adminTgIds.has(Number(user.tgId));
  if (!user.isAdmin && !fromEnv) {
    await reply
      .code(403)
      .send({ error: "FORBIDDEN", message: "Раздел только для администраторов." });
    return;
  }

  if (!user.isAdmin) {
    req.auth.user = { ...user, isAdmin: true };
  }
}

export const adminPreHandler = [adminGuard];
