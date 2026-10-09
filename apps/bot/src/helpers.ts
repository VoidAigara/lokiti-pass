import type { Context } from "grammy";
import { api, dropToken, getToken, ApiError, type TgProfile } from "./api.js";
import { isAdmin } from "./config.js";

export function profileOf(ctx: Context): TgProfile {
  const u = ctx.from;
  if (!u) throw new Error("Нет данных отправителя");
  return {
    tgId: u.id,
    firstName: u.first_name ?? null,
    username: u.username ?? null,
  };
}

export async function tokenFor(ctx: Context): Promise<string> {
  return getToken(profileOf(ctx));
}

async function callApiOnce<T>(
  ctx: Context,
  path: string,
  opts: { method?: string; body?: unknown }
): Promise<T> {
  const token = await tokenFor(ctx);
  if (opts.method === "POST") {
    return api.post<T>(token, path, opts.body);
  }
  if (opts.method === "PATCH") {
    return api.patch<T>(token, path, opts.body);
  }
  return api.get<T>(token, path);
}

/**
 * Кэшированный JWT живёт вечно, а сам токен протухает по JWT_TTL (7 дней) —
 * без рефреша бот «умрёт» навсегда через неделю непрерывной работы.
 * На 401 сбрасываем кэш и повторяем ровно один раз с новым токеном.
 */
export async function callApi<T>(
  ctx: Context,
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  try {
    return await callApiOnce<T>(ctx, path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      dropToken(profileOf(ctx).tgId);
      return callApiOnce<T>(ctx, path, opts);
    }
    throw err;
  }
}

export function isAdminCtx(ctx: Context): boolean {
  return isAdmin(ctx.from?.id ?? 0);
}

export function humanApiError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Неизвестная ошибка";
}
