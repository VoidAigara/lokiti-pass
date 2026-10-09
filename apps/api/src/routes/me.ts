import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MeResponse, PaymentDto, SeasonDto } from "@loki/shared";
import { TICKET_LIMITS, validateMcNick } from "@loki/shared";
import { prismaStore } from "../services/store-prisma.js";
import {
  buildOffer,
  ensurePlayerWithNick,
} from "../services/payments.js";
import type { PaymentRec, SeasonRec } from "../services/types.js";
import { requireAuth } from "../plugins/auth.js";

export function seasonToDto(s: SeasonRec): SeasonDto {
  return {
    id: s.id,
    number: s.number,
    name: s.name,
    isActive: s.isActive,
    priceNew: s.priceNew,
    priceRenew: s.priceRenew,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

export async function paymentToDto(
  p: PaymentRec,
  seasons: Map<string, SeasonRec>
): Promise<PaymentDto> {
  let seasonNumber: number | null = null;
  if (p.seasonId) {
    const cached = seasons.get(p.seasonId);
    if (cached) {
      seasonNumber = cached.number;
    } else {
      const s = await prismaStore.getSeasonById(p.seasonId);
      if (s) {
        seasons.set(p.seasonId, s);
        seasonNumber = s.number;
      }
    }
  }

  return {
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    type: p.type,
    provider: p.provider,
    status: p.status,
    description: p.description,
    confirmationUrl: p.confirmationUrl,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    refundedAt: p.refundedAt ? p.refundedAt.toISOString() : null,
    refundReason: p.refundReason,
    seasonNumber,
  };
}

const NickBody = z.object({ mcNick: z.string().min(1).max(24) });

const TicketBody = z.object({
  type: z.enum(["SUPPORT", "REFUND_REQUEST"]),
  text: z.string().min(3).max(TICKET_LIMITS.supportText),
});

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  /** Профиль: игрок, оффер (цена), история платежей. */
  app.get("/me", async (req, reply) => {
    const userId = req.auth!.user.id;
    const [player, offer, payments] = await Promise.all([
      prismaStore.getPlayerByUserId(userId),
      buildOffer(prismaStore, userId),
      prismaStore.listUserPayments(userId, 50),
    ]);

    const seasons = new Map<string, SeasonRec>();
    const paymentDtos = await Promise.all(
      payments.map((p) => paymentToDto(p, seasons))
    );

    const currentSeason = player?.currentSeasonId
      ? await prismaStore.getSeasonById(player.currentSeasonId)
      : null;

    const offerSeason = offer.season
      ? (seasons.get(offer.season.id) ??
        (await prismaStore.getSeasonById(offer.season.id)))
      : null;
    if (offerSeason) seasons.set(offerSeason.id, offerSeason);

    const res: MeResponse = {
      user: {
        id: req.auth!.user.id,
        tgId: req.auth!.user.tgId,
        tgUsername: req.auth!.user.tgUsername,
        firstName: req.auth!.user.firstName,
        isAdmin: req.auth!.user.isAdmin,
      },
      player: player
        ? {
            mcNick: player.mcNick,
            status: player.status,
            currentSeason: currentSeason ? seasonToDto(currentSeason) : null,
            totalPaid: player.totalPaid,
            renewalCount: player.renewalCount,
            firstPaidAt: player.firstPaidAt?.toISOString() ?? null,
            lastPaidAt: player.lastPaidAt?.toISOString() ?? null,
            banReason: player.banReason,
          }
        : null,
      offer: {
        kind: offer.kind,
        amount: offer.amount,
        type: offer.type,
        reason: offer.reason,
        season: offerSeason ? seasonToDto(offerSeason) : null,
      },
      payments: paymentDtos,
    };
    reply.send(res);
  });

  /** Первая привязка ника. Смена — только через тикет. */
  app.post("/me/nick", async (req, reply) => {
    const body = NickBody.parse(req.body);
    const userId = req.auth!.user.id;

    const player = await prismaStore.getPlayerByUserId(userId);
    if (player) {
      reply.code(409).send({
        error: "CONFLICT",
        message: `Ник уже привязан (${player.mcNick}). Смена — через /nick в боте.`,
      });
      return;
    }

    const v = validateMcNick(body.mcNick);
    if (!v.ok) {
      reply.code(400).send({ error: "VALIDATION", message: v.reason });
      return;
    }

    const created = await ensurePlayerWithNick(prismaStore, userId, body.mcNick);
    reply.send({ mcNick: created.mcNick, status: created.status });
  });

  /** Тикет в поддержку / запрос возврата. */
  app.post("/me/tickets", async (req, reply) => {
    const body = TicketBody.parse(req.body);
    const ticket = await prismaStore.createTicket({
      userId: req.auth!.user.id,
      type: body.type,
      payload: { text: body.text },
    });
    reply.code(201).send({ id: ticket.id, status: ticket.status });
  });

  /** Заявка на смену ника — ждёт одобрения модератора. */
  app.post("/me/nick-request", async (req, reply) => {
    const body = z.object({ newNick: z.string().min(1).max(24) }).parse(req.body);
    const userId = req.auth!.user.id;

    const v = validateMcNick(body.newNick);
    if (!v.ok) {
      reply.code(400).send({ error: "VALIDATION", message: v.reason });
      return;
    }

    const player = await prismaStore.getPlayerByUserId(userId);
    if (!player) {
      reply.code(409).send({
        error: "CONFLICT",
        message: "Сначала привяжи ник — менять пока нечего.",
      });
      return;
    }
    if (player.mcNickLower === v.nickLower) {
      reply.code(409).send({
        error: "CONFLICT",
        message: "Это твой текущий ник.",
      });
      return;
    }

    const taken = await prismaStore.getPlayerByNickLower(v.nickLower);
    if (taken && taken.userId !== userId) {
      reply.code(409).send({
        error: "NICK_TAKEN",
        message: "Этот ник уже занят другим игроком.",
      });
      return;
    }

    const open = (await prismaStore.listNickRequests("OPEN")).find(
      (r) => r.userId === userId
    );
    if (open) {
      reply.code(409).send({
        error: "CONFLICT",
        message: "У тебя уже есть заявка на смену ника. Дождись решения.",
      });
      return;
    }

    const created = await prismaStore.createNickRequest({
      userId,
      oldNick: player.mcNick,
      newNick: v.nick,
      newNickLower: v.nickLower,
      reason: null,
    });
    reply.code(201).send({ id: created.id, status: created.status });
  });

  app.get("/me/tickets", async (req, reply) => {
    // фильтр по владельцу — на уровне БД, а не post-filter по всем тикетам
    const mine = await prismaStore.listTickets(undefined, req.auth!.user.id);
    reply.send({ tickets: mine });
  });
}
