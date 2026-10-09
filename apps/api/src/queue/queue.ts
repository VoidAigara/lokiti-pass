import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config.js";
import { logger } from "../lib/logger.js";
import type { Deps } from "../services/ports.js";
import {
  processWhitelistAdd,
  processWhitelistRemove,
} from "../services/settle.js";
import type { DomainStore } from "../services/types.js";

export const WHITELIST_QUEUE = "mc-whitelist";

export type WhitelistJobData =
  | { action: "whitelist_add"; paymentId: string; playerId: string; nick: string; seasonId: string }
  | { action: "whitelist_remove"; playerId: string; nick: string; seasonId: string | null; reason?: string };

let connection: Redis | null = null;
let queue: Queue<WhitelistJobData> | null = null;
let worker: Worker<WhitelistJobData> | null = null;

export function getRedis(): Redis {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    connection.on("error", (err: Error) =>
      logger.error({ err }, "Redis connection error")
    );
  }
  return connection;
}

const defaultJobOptions: JobsOptions = {
  attempts: env.QUEUE_ATTEMPTS,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function getQueue(): Queue<WhitelistJobData> {
  if (!queue) {
    queue = new Queue<WhitelistJobData>(WHITELIST_QUEUE, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return queue;
}

/** Запуск воркера очереди (в проде — в отдельном процессе или здесь же). */
export function startWorker(deps: Deps): Worker<WhitelistJobData> {
  if (worker) return worker;

  worker = new Worker<WhitelistJobData>(
    WHITELIST_QUEUE,
    async (job) => {
      const data = job.data;
      logger.info(
        { jobId: job.id, action: data.action, nick: data.nick, attempt: job.attemptsMade + 1 },
        "processing whitelist job"
      );

      if (data.action === "whitelist_add") {
        const res = await processWhitelistAdd(deps, {
          paymentId: data.paymentId,
          playerId: data.playerId,
          nick: data.nick,
          seasonId: data.seasonId,
        });
        return res;
      }

      await processWhitelistRemove(deps, {
        playerId: data.playerId,
        nick: data.nick,
        seasonId: data.seasonId,
        reason: data.reason,
      });
      return { status: "removed" };
    },
    {
      connection: getRedis(),
      concurrency: env.QUEUE_WHITELIST_CONCURRENCY,
      lockDuration: 60_000,
    }
  );

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, result }, "whitelist job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, err, attempts: job?.attemptsMade },
      "whitelist job failed"
    );
  });

  return worker;
}

export async function closeQueue(): Promise<void> {
  try {
    await worker?.close();
    await queue?.close();
    await connection?.quit();
  } catch (err) {
    logger.warn({ err }, "error closing queue");
  } finally {
    worker = null;
    queue = null;
    connection = null;
  }
}

/** Реализация очереди поверх BullMQ. */
export function createBullQueueAdapter() {
  return {
    async enqueueAdd(job: {
      paymentId: string;
      playerId: string;
      nick: string;
      seasonId: string;
    }) {
      if (!job.seasonId) throw new Error("enqueueAdd: seasonId обязателен");
      await getQueue().add("whitelist_add", { action: "whitelist_add", ...job });
    },
    async enqueueRemove(job: {
      playerId: string;
      nick: string;
      seasonId: string | null;
      reason?: string;
    }) {
      await getQueue().add("whitelist_remove", {
        action: "whitelist_remove",
        ...job,
      });
    },
  };
}

export async function pingRedis(): Promise<{ ok: boolean; message?: string }> {
  try {
    const pong = await getRedis().ping();
    return { ok: pong === "PONG" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type { DomainStore };
