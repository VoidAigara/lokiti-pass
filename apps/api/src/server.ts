import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config.js";
import { createDeps } from "./adapters/wiring.js";
import { startWorker, closeQueue } from "./queue/queue.js";
import { closeRcon } from "./lib/rcon.js";
import { logger } from "./lib/logger.js";

async function main(): Promise<void> {
  const deps = createDeps();
  const app = await buildApp({ deps });

  // воркер очереди живёт рядом с API (для масштабирования вынесите в отдельный сервис)
  startWorker(deps);

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, url: env.API_URL },
    "API запущен"
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down…");
    try {
      await app.close();
      await closeQueue();
      await closeRcon();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown error");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "unhandledRejection");
  });
}

main().catch((err) => {
  logger.error({ err }, "API failed to start");
  process.exit(1);
});
