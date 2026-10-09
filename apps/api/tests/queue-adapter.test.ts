import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    queues: [] as Array<{ name: string; opts: unknown }>,
    added: [] as Array<{ queue: string; name: string; data: unknown }>,
  };

  class FakeRedis {
    on(): void {}
    async ping(): Promise<string> {
      return "PONG";
    }
    async quit(): Promise<void> {}
  }

  class FakeQueue<T> {
    constructor(
      private name: string,
      opts: unknown
    ) {
      state.queues.push({ name, opts });
    }
    async add(name: string, data: T): Promise<void> {
      state.added.push({ queue: this.name, name, data });
    }
    async close(): Promise<void> {}
  }

  class FakeWorker {
    constructor(..._args: unknown[]) {}
    on(): void {}
    async close(): Promise<void> {}
  }

  return { state, FakeRedis, FakeQueue, FakeWorker };
});

const state = h.state;

vi.mock("ioredis", () => ({ default: h.FakeRedis, Redis: h.FakeRedis }));
vi.mock("bullmq", () => ({ Queue: h.FakeQueue, Worker: h.FakeWorker }));

import {
  WHITELIST_QUEUE,
  closeQueue,
  createBullQueueAdapter,
  getQueue,
  pingRedis,
} from "../src/queue/queue.js";

beforeEach(async () => {
  await closeQueue();
  state.queues.length = 0;
  state.added.length = 0;
});

describe("bullmq-адаптер очереди", () => {
  it("enqueueAdd без seasonId — ошибка до подключения к Redis", async () => {
    const adapter = createBullQueueAdapter();
    await expect(
      adapter.enqueueAdd({ paymentId: "p1", playerId: "pl1", nick: "Nick", seasonId: "" })
    ).rejects.toThrow(/seasonId обязателен/);
    expect(state.added).toHaveLength(0);
  });

  it("enqueueAdd кладёт job с action и всеми полями", async () => {
    const adapter = createBullQueueAdapter();
    await adapter.enqueueAdd({
      paymentId: "pay_1",
      playerId: "pl_1",
      nick: "Loki",
      seasonId: "s_1",
    });
    expect(state.added).toHaveLength(1);
    expect(state.added[0]).toEqual({
      queue: WHITELIST_QUEUE,
      name: "whitelist_add",
      data: {
        action: "whitelist_add",
        paymentId: "pay_1",
        playerId: "pl_1",
        nick: "Loki",
        seasonId: "s_1",
      },
    });
  });

  it("enqueueRemove кладёт job c seasonId:null и причиной", async () => {
    const adapter = createBullQueueAdapter();
    await adapter.enqueueRemove({
      playerId: "pl_1",
      nick: "Loki",
      seasonId: null,
      reason: "возврат",
    });
    expect(state.added[0]).toEqual({
      queue: WHITELIST_QUEUE,
      name: "whitelist_remove",
      data: {
        action: "whitelist_remove",
        playerId: "pl_1",
        nick: "Loki",
        seasonId: null,
        reason: "возврат",
      },
    });
  });

  it("defaultJobOptions: attempts из env (5) и exponential backoff", () => {
    const q = getQueue();
    const opts = state.queues.find((x) => x.name === WHITELIST_QUEUE)?.opts as {
      defaultJobOptions: { attempts: number; backoff: { type: string; delay: number } };
    };
    expect(q).toBeTruthy();
    expect(opts.defaultJobOptions.attempts).toBe(5);
    expect(opts.defaultJobOptions.backoff).toEqual({ type: "exponential", delay: 2000 });
  });

  it("pingRedis: PONG → ok", async () => {
    expect(await pingRedis()).toEqual({ ok: true });
  });

  it("closeQueue сбрасывает синглтоны (повторный getQueue создаёт заново)", async () => {
    getQueue();
    expect(state.queues).toHaveLength(1);
    await closeQueue();
    getQueue();
    expect(state.queues).toHaveLength(2);
  });
});
