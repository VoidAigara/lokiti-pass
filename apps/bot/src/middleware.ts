import { Context, type NextFunction } from "grammy";
import { botEnv } from "./config.js";

const buckets = new Map<string, number[]>();
const MAX = botEnv.RATE_LIMIT_PER_MIN;
const WINDOW_MS = 60_000;

/** Скользящее окно: не более RATE_LIMIT_PER_MIN сообщений на юзера в минуту. */
export async function rateLimit(ctx: Context, next: NextFunction): Promise<void> {
  const id = ctx.from?.id;
  if (id == null) return next();

  const key = String(id);
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (arr.length >= MAX) {
    await ctx.reply("⏳ Слишком много сообщений. Подожди минуту.");
    return;
  }

  arr.push(now);
  buckets.set(key, arr);

  if (buckets.size > 20_000) {
    // простая уборка, чтобы карта не росла бесконечно
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= WINDOW_MS)) buckets.delete(k);
    }
  }

  await next();
}

export async function errorBoundary(ctx: Context, next: NextFunction): Promise<void> {
  try {
    await next();
  } catch (err) {
    // grammY сам логирует ошибки наружного handler'а; здесь — вежливый ответ
    const msg =
      err instanceof Error ? err.message : "неизвестная ошибка";
    if (/fetch failed|ECONNREFUSED|aborted/i.test(msg)) {
      await ctx.reply(
        "🛠 Сервис оплаты временно недоступен. Попробуй через пару минут."
      ).catch(() => undefined);
    } else {
      await ctx.reply(
        "⚠️ Что-то пошло не так. Попробуй ещё раз или напиши /support."
      ).catch(() => undefined);
    }
  }
}
