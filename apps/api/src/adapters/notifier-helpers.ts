import { logger } from "../lib/logger.js";
import type { Deps } from "../services/ports.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Рассылка с троттлингом (лимит Telegram ~30 сообщений/сек на бота).
 * Ошибки не роняют процесс — фиксируем failed.
 */
export async function broadcast(
  deps: Deps,
  userIds: string[],
  html: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  let sinceDelay = 0;

  for (const userId of userIds) {
    try {
      const user = await deps.store.getUserById(userId);
      if (!user) continue;
      await deps.notifier.broadcast(user.tgId, html);
      sent++;
    } catch (err) {
      failed++;
      logger.warn({ err, userId }, "broadcast message failed");
    }

    sinceDelay++;
    if (sinceDelay >= 25) {
      sinceDelay = 0;
      await sleep(1100);
    }
  }

  return { sent, failed };
}
