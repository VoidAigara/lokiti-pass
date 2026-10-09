import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/tests/**/*.test.ts", "apps/**/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // часть сервисов тянет config.ts (валидацию окружения) — тестовые заглушки
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test?schema=public",
      BOT_TOKEN: "1:TEST_TOKEN",
      JWT_SECRET: "test-jwt-secret-0123456789abcdef-32chars-min",
      INTERNAL_TOKEN: "test-internal-token-0123456789abcdef-32+",
      // tgId тестового админа — adminTgIds наполняется при импорте config
      ADMIN_TG_IDS: "968363862",
      // глобальный лимит, чтобы сотни запросов в suite не упирались в 429
      RATE_LIMIT_PER_MIN: "600",
      // демо-вебхук (YooKassa не настроена): payload — источник истины
      DEMO_WEBHOOK_TRUST: "true",
      // IP-allowlist вебхука: тесты ходят с 127.0.0.1, чужой IP получит 403
      YOOKASSA_WEBHOOK_IPS: "127.0.0.1",
      STARS_RUB_PER_STAR: "2",
    },
  },
});
