import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(3001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),

  WEB_URL: z.string().default("http://localhost:3000"),
  API_URL: z.string().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  BOT_TOKEN: z.string().min(1),
  ADMIN_TG_IDS: z.string().default(""),
  TELEGRAM_API_URL: z.string().default("https://api.telegram.org"),

  JWT_SECRET: z.string().min(32),
  JWT_TTL: z.string().default("7d"),
  /**
   * Секретный заголовок x-internal-token — бот → API (server-to-server).
   * Обязателен: минимум 32 символа, дефолты-заглушки запрещены.
   */
  INTERNAL_TOKEN: z
    .string()
    .min(32, "INTERNAL_TOKEN должен быть длиннее 32 символов")
    .refine(
      (v) => !/^(CHANGE_ME|changeme|change-me)/i.test(v),
      "INTERNAL_TOKEN не должен быть заглушкой (CHANGE_ME...)"
    ),

  /**
   * Доверенные прокси (через запятую, IP/CIDR).
   * Пусто → X-Forwarded-For игнорируется, req.ip = сокет.
   * Задавать только когда за API действительно стоит reverse-proxy.
   */
  TRUSTED_PROXIES: z.string().default(""),

  YOOKASSA_SHOP_ID: z.string().default(""),
  YOOKASSA_SECRET_KEY: z.string().default(""),
  YOOKASSA_WEBHOOK_IPS: z.string().default(""),
  YOOKASSA_IDEMPOTENCE_KEY: z.string().optional(),
  YOOKASSA_RECEIPT: bool(false),
  YOOKASSA_VAT_CODE: int(1),
  YOOKASSA_TAXATION_SYSTEM: int(1),

  STARS_ENABLED: bool(true),
  /** 1 звезда ≈ сколько ₽ (сверка суммы звёзд против суммы платежа). */
  STARS_RUB_PER_STAR: int(2).pipe(z.number().int().positive()),
  /**
   * Доверять payload вебхука без проверки в YooKassa API — только когда
   * YooKassa не настроена (локальная разработка/smoke). В проде не включать.
   */
  DEMO_WEBHOOK_TRUST: bool(false),

  MC_HOST: z.string().default("127.0.0.1"),
  MC_RCON_PORT: int(25575),
  MC_RCON_PASSWORD: z.string().default(""),
  MC_QUERY_HOST: z.string().default("127.0.0.1"),
  MC_QUERY_PORT: int(25565),
  MC_SERVER_IP: z.string().default("play.example.ru"),

  QUEUE_WHITELIST_CONCURRENCY: int(2),
  QUEUE_ATTEMPTS: int(5),

  ADMIN_IP_ALLOWLIST: z.string().default(""),
  RATE_LIMIT_PER_MIN: int(10),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Некорректное окружение (.env):\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const adminTgIds = new Set(
  env.ADMIN_TG_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n))
);

export function isAdminTgId(tgId: number | bigint): boolean {
  return adminTgIds.has(Number(tgId));
}

export const isProd = env.NODE_ENV === "production";
