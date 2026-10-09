import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, validateTelegramInitData } from "../src/telegram-auth.js";
import { validateMcNick } from "../src/validation.js";

const BOT_TOKEN = "1234567890:TEST-TOKEN-abcdef";

/** Собираем initData так же, как это делает Telegram WebApp. */
function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set("hash", hash);
  return params.toString();
}

const user = JSON.stringify({ id: 42, first_name: "Loki", username: "loki" });

describe("validateTelegramInitData", () => {
  it("принимает подписанную строку и достаёт пользователя", () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAF",
      user,
    });

    const parsed = validateTelegramInitData(initData, BOT_TOKEN, 3600);
    expect(parsed).not.toBeNull();
    expect(parsed?.user?.id).toBe(42);
    expect(parsed?.user?.username).toBe("loki");
    expect(parsed?.query_id).toBe("AAF");
  });

  it("отклоняет подделанный hash", () => {
    const initData = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user,
      hash: "deadbeef".repeat(8),
    }).toString();

    expect(validateTelegramInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it("отклоняет неверный токен бота", () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user,
    });
    expect(validateTelegramInitData(initData, "000:WRONG")).toBeNull();
  });

  it("отклоняет устаревший auth_date", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 7200);
    const initData = signInitData({ auth_date: stale, user });
    expect(validateTelegramInitData(initData, BOT_TOKEN, 3600)).toBeNull();
  });

  it("отклоняет пустые данные", () => {
    expect(validateTelegramInitData("", BOT_TOKEN)).toBeNull();
    expect(validateTelegramInitData("user=x", BOT_TOKEN)).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("стабильно хеширует JWT для таблицы Session", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toHaveLength(64);
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});

describe("validateMcNick", () => {
  it("принимает валидные ники", () => {
    for (const nick of ["Steve", "Loki_Ti", "x_1", "A".repeat(16)]) {
      expect(validateMcNick(nick).ok, nick).toBe(true);
    }
  });

  it("отклоняет невалидные ники", () => {
    for (const nick of ["ab", "", "A".repeat(17), "Никил", "with space", "с__id"]) {
      expect(validateMcNick(nick).ok, nick).toBe(false);
    }
  });

  it("возвращает нормализованный ник и нижний регистр", () => {
    const res = validateMcNick("Loki_Ti");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.nick).toBe("Loki_Ti");
      expect(res.nickLower).toBe("loki_ti");
    }
  });
});
