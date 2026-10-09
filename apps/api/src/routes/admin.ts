import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminGuard } from "../plugins/admin.js";
import { getClientIp } from "../plugins/auth.js";
import { prismaStore } from "../services/store-prisma.js";
import {
  declareWipe,
  closeSeason,
  getStats,
  setSeasonPrices,
} from "../services/admin.js";
import { refundPayment } from "../services/settle.js";
import { manualSettle } from "./payments.js";
import { paymentToDto, seasonToDto } from "./me.js";
import type { Deps } from "../services/ports.js";
import type { PaymentStatus, SeasonRec } from "../services/types.js";

const StatsQuery = z.object({});

const RefundBody = z.object({
  reason: z.string().min(3).max(500),
  amount: z.number().int().positive().optional(),
});

const WipeBody = z.object({
  name: z.string().min(2).max(60),
  priceNew: z.number().int().positive(),
  priceRenew: z.number().int().positive(),
});

const PricesBody = z.object({
  priceNew: z.number().int().positive(),
  priceRenew: z.number().int().positive(),
});

export function adminCoreRoutes(
  deps: Deps
): (app: FastifyInstance) => Promise<void> {
  return async function (app: FastifyInstance) {
    app.addHook("preHandler", adminGuard);

    /** Сводка: деньги, конверсия, активные игроки. */
    app.get("/admin/stats", async (req, reply) => {
      StatsQuery.parse(req.query);
      const stats = await getStats(deps);
      const seasons = await prismaStore.listSeasons();

      const seasonsMap = new Map<string, SeasonRec>();
      const recent = await Promise.all(
        stats.recentPayments.map((p) => paymentToDto(p, seasonsMap))
      );

      reply.send({
        season: stats.season ? seasonToDto(stats.season) : null,
        totals: stats.totals,
        conversion: stats.conversion,
        recentPayments: recent,
        seasons: seasons.map(seasonToDto),
      });
    });

    app.get("/admin/payments", async (req, reply) => {
      const q = z
        .object({
          status: z.enum(["PENDING", "PAID", "REFUNDED", "FAILED", "CANCELED"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);

      const list = await prismaStore.listPayments({
        status: q.status as PaymentStatus | undefined,
        limit: q.limit,
        offset: q.offset,
      });
      const seasonsMap = new Map<string, SeasonRec>();
      const items = await Promise.all(list.map((p) => paymentToDto(p, seasonsMap)));

      reply.send({ payments: items, limit: q.limit, offset: q.offset });
    });

    /** Ручной возврат — только сюда, только с причиной, всё в AuditLog. */
    app.post<{ Params: { id: string } }>(
      "/admin/payments/:id/refund",
      async (req, reply) => {
        const body = RefundBody.parse(req.body);
        const payment = await refundPayment(deps, {
          paymentId: req.params.id,
          reason: body.reason,
          amount: body.amount,
          actorId: req.auth!.user.id,
          actorTgId: req.auth!.user.tgId,
          ip: getClientIp(req),
        });

        const seasonsMap = new Map<string, SeasonRec>();
        reply.send({ payment: await paymentToDto(payment, seasonsMap) });
      }
    );

    /** Подтвердить платёж вручную (перенос DonationAlerts, тех. сбой). */
    app.post<{ Params: { id: string } }>("/admin/payments/:id/settle", async (req, reply) => {
      await manualSettle(deps, req.params.id, {
        actorId: req.auth!.user.id,
        actorTgId: req.auth!.user.tgId,
      });
      reply.send({ ok: true });
    });

    /** Объявить вайп / новый сезон. */
    app.post("/admin/seasons/wipe", async (req, reply) => {
      const body = WipeBody.parse(req.body);
      const season = await declareWipe(deps, {
        name: body.name,
        priceNew: body.priceNew,
        priceRenew: body.priceRenew,
        actor: {
          actorId: req.auth!.user.id,
          actorTgId: req.auth!.user.tgId,
          ip: getClientIp(req),
        },
      });
      reply.send({ season: seasonToDto(season) });
    });

    app.post<{ Params: { id: string } }>("/admin/seasons/:id/close", async (req, reply) => {
      await closeSeason(deps, req.params.id, {
        actorId: req.auth!.user.id,
        actorTgId: req.auth!.user.tgId,
        ip: getClientIp(req),
      });
      reply.send({ ok: true });
    });

    app.patch<{ Params: { id: string } }>("/admin/seasons/:id", async (req, reply) => {
      const body = PricesBody.parse(req.body);
      const season = await setSeasonPrices(
        deps,
        req.params.id,
        body,
        {
          actorId: req.auth!.user.id,
          actorTgId: req.auth!.user.tgId,
          ip: getClientIp(req),
        }
      );
      reply.send({ season: seasonToDto(season) });
    });

    app.get("/admin/whitelist-log", async (req, reply) => {
      const q = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(req.query);
      reply.send({ log: await prismaStore.listWhitelistLog(q.limit) });
    });

    app.get("/admin/audit", async (req, reply) => {
      const q = z
        .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
        .parse(req.query);
      reply.send({ audit: await prismaStore.listAudit(q.limit) });
    });
  };
}
