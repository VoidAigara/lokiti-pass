// CI-обёртка для GitHub Actions: держит бота меньше 6-часового лимита раннера
// и корректно завершается, чтобы следующая задача из concurrency-очереди
// стартовала сразу. CI_BOT_LIMIT_MS — переопределение лимита для smoke-тестов.
import { spawn } from "node:child_process";

const LIMIT_MS = Number(process.env.CI_BOT_LIMIT_MS ?? (5 * 60 + 50) * 60 * 1000);

const bot = spawn(process.execPath, ["apps/bot/dist/index.js"], {
  stdio: "inherit",
});

const cap = setTimeout(() => {
  console.log(`[ci] лимит ${Math.round(LIMIT_MS / 1000)}с — останавливаю бота для перезапуска`);
  bot.kill("SIGTERM");
}, LIMIT_MS);

bot.on("exit", (code, signal) => {
  clearTimeout(cap);
  process.exit(code ?? (signal ? 1 : 0));
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => bot.kill(sig));
}
