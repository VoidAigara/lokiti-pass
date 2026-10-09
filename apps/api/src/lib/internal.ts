import { timingSafeEqual } from "node:crypto";
import { env } from "../config.js";

/**
 * Проверка x-internal-token (бот → API) в constant time.
 * Несовпадение длины — мгновенный false (без throw в timingSafeEqual).
 */
export function isInternalTokenValid(provided: unknown): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const expected = env.INTERNAL_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
