import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidInitData {
  auth_date: number;
  user?: InitDataUser;
  query_id?: string;
  start_param?: string;
  raw: Record<string, string>;
}

/**
 * Валидация Telegram WebApp initData (HMAC-SHA256).
 *
 * Алгоритм (документация Telegram):
 *   1. data-check-string = пары key=value, отсортированные по key, склеенные \n
 *   2. secret_key = HMAC_SHA256("WebAppData", BOT_TOKEN)
 *   3. hash = HMAC_SHA256(secret_key, data-check-string)
 *   4. сравнить с полем hash (hex), через timingSafeEqual
 *
 * @param initData   строка window.WebApp.initData
 * @param botToken   токен бота
 * @param maxAgeSec  максимальная «свежесть» (рекомендация — не больше часа)
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 3600
): ValidInitData | null {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  params.delete("signature");

  const pairs: string[] = [];
  params.forEach((value, key) => {
    pairs.push(`${key}=${value}`);
  });
  const dataCheckString = pairs.sort().join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(computed, hash)) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;

  if (maxAgeSec > 0) {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > maxAgeSec || age < -60) return null;
  }

  const raw: Record<string, string> = {};
  params.forEach((value, key) => {
    raw[key] = value;
  });

  let user: InitDataUser | undefined;
  const userJson = params.get("user");
  if (userJson) {
    try {
      user = JSON.parse(userJson) as InitDataUser;
    } catch {
      return null;
    }
  }

  return {
    auth_date: authDate,
    user,
    query_id: params.get("query_id") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
    raw,
  };
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** SHA-256 hex — используется для хранения JWT в таблице Session. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
