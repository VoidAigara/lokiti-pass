import type { FastifyInstance } from "fastify";
import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
} from "@loki/shared";
import { env } from "../config.js";
import { prismaStore } from "../services/store-prisma.js";
import { queryServerStatus } from "../lib/query.js";
import { logger } from "../lib/logger.js";
import { seasonToDto } from "./me.js";

interface CachedStatus {
  at: number;
  data: unknown;
}

let statusCache: CachedStatus | null = null;
const CACHE_MS = 15_000;

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  /** Активный сезон и цены — для лендинга и витрины. */
  app.get("/public/season", async (_req, reply) => {
    const season = await prismaStore.getActiveSeason();
    reply.send({
      season: season ? seasonToDto(season) : null,
      serverIp: env.MC_SERVER_IP,
      prices: {
        new: season?.priceNew ?? DEFAULT_PRICE_NEW_KOPECKS,
        renew: season?.priceRenew ?? DEFAULT_PRICE_RENEW_KOPECKS,
      },
    });
  });

  /** Онлайн сервера (GameQuery) с коротким кешем. */
  app.get("/public/status", async (_req, reply) => {
    if (statusCache && Date.now() - statusCache.at < CACHE_MS) {
      reply.send(statusCache.data);
      return;
    }

    let data: Record<string, unknown>;
    try {
      const st = await queryServerStatus();
      data = {
        ok: true,
        online: st.online,
        max: st.max,
        hostname: st.hostname ?? null,
        version: st.version ?? null,
        serverIp: env.MC_SERVER_IP,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.debug({ err }, "query failed");
      data = {
        ok: false,
        online: null,
        max: null,
        serverIp: env.MC_SERVER_IP,
        checkedAt: new Date().toISOString(),
      };
    }

    statusCache = { at: Date.now(), data };
    reply.send(data);
  });
}
