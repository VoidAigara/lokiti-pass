import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
  return v;
}

export const botEnv = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  BOT_TOKEN: required("BOT_TOKEN"),
  ADMIN_TG_IDS: new Set(
    (process.env.ADMIN_TG_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n))
  ),
  API_URL: (process.env.API_URL ?? "http://localhost:3001").replace(/\/$/, ""),
  INTERNAL_TOKEN: process.env.INTERNAL_TOKEN ?? "",
  WEB_URL: (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  MC_SERVER_IP: process.env.MC_SERVER_IP ?? "play.lokiti.ru",
  /** 1 звезда ≈ сколько ₽ (цена задаётся в @BotFather при включении Stars). */
  STARS_RUB_PER_STAR: Number(process.env.STARS_RUB_PER_STAR ?? 2),
  STARS_ENABLED: (process.env.STARS_ENABLED ?? "true") === "true",
  RATE_LIMIT_PER_MIN: Number(process.env.RATE_LIMIT_PER_MIN ?? 10),
  /** куда слать алерты, если API/бот упал */
  ALERT_CHAT_ID: process.env.ALERT_CHAT_ID ?? "",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
};

export function isAdmin(tgId: number | bigint): boolean {
  return botEnv.ADMIN_TG_IDS.has(Number(tgId));
}
