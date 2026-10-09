import { prisma, Prisma } from "@loki/db";
import type {
  PaymentStatus,
  PaymentType,
  PlayerStatus,
  TicketStatus,
  TicketType,
} from "@loki/db";
import type {
  AuditLogRec,
  DomainStore,
  NickRequestDetail,
  NickRequestRec,
  PaymentRec,
  PlayerRec,
  SeasonRec,
  TicketDetail,
  TicketRec,
  UserBrief,
  UserRec,
  WhitelistLogRec,
} from "./types.js";

const toStr = (v: bigint | number | string): string => String(v);

function mapUser(u: {
  id: string;
  tgId: bigint;
  tgUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  isBanned: boolean;
}): UserRec {
  return {
    id: u.id,
    tgId: toStr(u.tgId),
    tgUsername: u.tgUsername,
    firstName: u.firstName,
    lastName: u.lastName,
    isAdmin: u.isAdmin,
    isBanned: u.isBanned,
  };
}

function mapBrief(u: {
  id: string;
  tgId: bigint;
  tgUsername: string | null;
  firstName: string | null;
}): UserBrief {
  return {
    id: u.id,
    tgId: toStr(u.tgId),
    tgUsername: u.tgUsername,
    firstName: u.firstName,
  };
}

function mapSeason(s: {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
  priceNew: number;
  priceRenew: number;
  startedAt: Date;
  endedAt: Date | null;
}): SeasonRec {
  return { ...s };
}

function mapPlayer(p: {
  id: string;
  userId: string;
  mcNick: string;
  mcNickLower: string;
  status: PlayerStatus;
  currentSeasonId: string | null;
  totalPaid: number;
  renewalCount: number;
  firstPaidAt: Date | null;
  lastPaidAt: Date | null;
  banReason: string | null;
  bannedAt: Date | null;
}): PlayerRec {
  return { ...p };
}

function mapPayment(p: {
  id: string;
  userId: string;
  seasonId: string | null;
  playerId: string | null;
  amount: number;
  currency: string;
  type: PaymentType;
  provider: PaymentProviderLike;
  providerPaymentId: string | null;
  confirmationUrl: string | null;
  idempotencyKey: string | null;
  description: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  refundReason: string | null;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
}): PaymentRec {
  return { ...p, provider: p.provider as PaymentRec["provider"] };
}

type PaymentProviderLike = PaymentRec["provider"];

function jsonPayload(v: Prisma.JsonValue): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function mapTicket(t: {
  id: string;
  userId: string;
  type: TicketType;
  status: TicketStatus;
  payload: Prisma.JsonValue;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}): TicketRec {
  return {
    id: t.id,
    userId: t.userId,
    type: t.type,
    status: t.status,
    payload: jsonPayload(t.payload),
    resolutionNote: t.resolutionNote,
    resolvedAt: t.resolvedAt,
    createdAt: t.createdAt,
  };
}

function mapNickRequest(n: {
  id: string;
  userId: string;
  oldNick: string | null;
  newNick: string;
  newNickLower: string;
  reason: string | null;
  status: TicketStatus;
  note: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): NickRequestRec {
  return { ...n };
}

export const prismaStore: DomainStore = {
  // ---------------- users ----------------
  async findUserByTgId(tgId) {
    const u = await prisma.user.findUnique({ where: { tgId: BigInt(tgId) } });
    return u ? mapUser(u) : null;
  },

  async getUserById(id) {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? mapUser(u) : null;
  },

  async upsertUser(data) {
    const u = await prisma.user.upsert({
      where: { tgId: BigInt(data.tgId) },
      create: {
        tgId: BigInt(data.tgId),
        tgUsername: data.tgUsername ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        isAdmin: data.isAdmin ?? false,
      },
      update: {
        tgUsername: data.tgUsername ?? undefined,
        firstName: data.firstName ?? undefined,
        lastName: data.lastName ?? undefined,
        ...(data.isAdmin !== undefined ? { isAdmin: data.isAdmin } : {}),
      },
    });
    return mapUser(u);
  },

  // ---------------- sessions ----------------
  async createSession(data) {
    const s = await prisma.session.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        ip: data.ip ?? null,
      },
      select: { id: true },
    });
    return { id: s.id };
  },

  async findSessionByHash(tokenHash) {
    const s = await prisma.session.findUnique({ where: { tokenHash } });
    if (!s) return null;
    return { id: s.id, userId: s.userId, expiresAt: s.expiresAt };
  },

  async deleteSession(id) {
    await prisma.session.deleteMany({ where: { id } });
  },

  // ---------------- seasons ----------------
  async getActiveSeason() {
    const s = await prisma.season.findFirst({
      where: { isActive: true },
      orderBy: { number: "desc" },
    });
    return s ? mapSeason(s) : null;
  },

  async getSeasonById(id) {
    const s = await prisma.season.findUnique({ where: { id } });
    return s ? mapSeason(s) : null;
  },

  async listSeasons() {
    const list = await prisma.season.findMany({ orderBy: { number: "desc" } });
    return list.map(mapSeason);
  },

  async createSeason(data) {
    const s = await prisma.season.create({
      data: {
        number: data.number,
        name: data.name,
        priceNew: data.priceNew,
        priceRenew: data.priceRenew,
        isActive: data.activate ?? false,
        startedAt: new Date(),
      },
    });
    return mapSeason(s);
  },

  async deactivateAllSeasons() {
    await prisma.season.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
  },

  async activateSeason(id) {
    await prisma.season.update({ where: { id }, data: { isActive: true } });
  },

  async closeSeason(id) {
    await prisma.season.update({
      where: { id },
      data: { isActive: false, endedAt: new Date() },
    });
  },

  async updateSeason(id, data) {
    const s = await prisma.season.update({ where: { id }, data });
    return mapSeason(s);
  },

  // ---------------- players ----------------
  async getPlayerByUserId(userId) {
    const p = await prisma.player.findFirst({ where: { userId } });
    return p ? mapPlayer(p) : null;
  },

  async getPlayerByNickLower(nickLower) {
    const p = await prisma.player.findUnique({ where: { mcNickLower: nickLower } });
    return p ? mapPlayer(p) : null;
  },

  async getPlayerById(id) {
    const p = await prisma.player.findUnique({ where: { id } });
    return p ? mapPlayer(p) : null;
  },

  async countPaidSeasons(playerId) {
    return prisma.playerSeason.count({
      where: { playerId, grantedAt: { not: null } },
    });
  },

  async createPlayer(data) {
    const p = await prisma.player.create({
      data: {
        userId: data.userId,
        mcNick: data.mcNick,
        mcNickLower: data.mcNickLower,
        status: data.status ?? "PENDING",
        currentSeasonId: data.currentSeasonId ?? null,
      },
    });
    return mapPlayer(p);
  },

  async updatePlayer(id, data) {
    const p = await prisma.player.update({
      where: { id },
      data: {
        ...data,
        ...(data.totalPaid !== undefined ? { totalPaid: data.totalPaid } : {}),
      },
    });
    return mapPlayer(p);
  },

  async countPlayersByStatus(status) {
    return prisma.player.count({ where: { status } });
  },

  async listAllPlayers() {
    const list = await prisma.player.findMany({ orderBy: { createdAt: "asc" } });
    return list.map(mapPlayer);
  },

  async listActiveNickNames() {
    const list = await prisma.player.findMany({
      where: { status: { in: ["ACTIVE", "PENDING", "EXPIRED"] } },
      select: { mcNick: true, mcNickLower: true, userId: true },
    });
    return list;
  },

  // ---------------- payments ----------------
  async createPayment(input) {
    const p = await prisma.payment.create({
      data: {
        userId: input.userId,
        seasonId: input.seasonId,
        playerId: input.playerId,
        amount: input.amount,
        currency: input.currency ?? "RUB",
        type: input.type,
        provider: input.provider,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return mapPayment(p);
  },

  async getPaymentById(id) {
    const p = await prisma.payment.findUnique({ where: { id } });
    return p ? mapPayment(p) : null;
  },

  async getPaymentByProviderId(providerPaymentId) {
    const p = await prisma.payment.findUnique({
      where: { providerPaymentId },
    });
    return p ? mapPayment(p) : null;
  },

  async listUserPayments(userId, limit = 50) {
    const list = await prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return list.map(mapPayment);
  },

  async listPayments(opts = {}) {
    const list = await prisma.payment.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    });
    return list.map(mapPayment);
  },

  async markPaymentPaid(id, data) {
    const updated = await prisma.payment.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "PAID",
        paidAt: data.paidAt ?? new Date(),
        ...(data.providerPaymentId ? { providerPaymentId: data.providerPaymentId } : {}),
      },
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
    return { payment: mapPayment(payment), firstTime: updated.count === 1 };
  },

  async updatePayment(id, data) {
    const p = await prisma.payment.update({ where: { id }, data });
    return mapPayment(p);
  },

  // ---------------- access / whitelist ----------------
  async grantAccess({ playerId, seasonId, amount, isRenewal }) {
    const now = new Date();
    await prisma.$transaction([
      prisma.playerSeason.upsert({
        where: { playerId_seasonId: { playerId, seasonId } },
        create: {
          playerId,
          seasonId,
          status: "ACTIVE",
          grantedAt: now,
          paidAmount: amount,
        },
        update: { status: "ACTIVE", grantedAt: now, revokedAt: null, paidAmount: amount },
      }),
      prisma.player.update({
        where: { id: playerId },
        data: {
          status: "ACTIVE",
          currentSeasonId: seasonId,
          lastPaidAt: now,
          ...(isRenewal ? { renewalCount: { increment: 1 } } : {}),
        },
      }),
    ]);
  },

  async revokeAccess({ playerId, seasonId }) {
    if (seasonId) {
      await prisma.playerSeason.updateMany({
        where: { playerId, seasonId, status: "ACTIVE" },
        data: { status: "EXPIRED", revokedAt: new Date() },
      });
      const other = await prisma.playerSeason.findFirst({
        where: { playerId, status: "ACTIVE" },
      });
      await prisma.player.update({
        where: { id: playerId },
        data: {
          status: other ? "ACTIVE" : "EXPIRED",
          currentSeasonId: other ? other.seasonId : null,
        },
      });
    } else {
      await prisma.player.update({
        where: { id: playerId },
        data: { status: "EXPIRED", currentSeasonId: null },
      });
      await prisma.playerSeason.updateMany({
        where: { playerId, status: "ACTIVE" },
        data: { status: "EXPIRED", revokedAt: new Date() },
      });
    }
  },

  async hasWhitelistLogForPayment(paymentId) {
    const n = await prisma.whitelistLog.count({
      where: { paymentId, action: "ADD" },
    });
    return n > 0;
  },

  async createWhitelistLog(data) {
    await prisma.whitelistLog.create({
      data: {
        mcNick: data.mcNick,
        mcNickLower: data.mcNickLower,
        action: data.action,
        actor: data.actor,
        seasonId: data.seasonId,
        paymentId: data.paymentId,
        note: data.note,
      },
    });
  },

  async listWhitelistLog(limit = 100) {
    const list = await prisma.whitelistLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return list.map((l) => ({ ...l, action: l.action as WhitelistLogRec["action"] }));
  },

  // ---------------- tickets ----------------
  async createTicket(data) {
    const t = await prisma.ticket.create({
      data: {
        userId: data.userId,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue,
      },
    });
    return mapTicket(t);
  },

  async listTickets(status, userId) {
    const list = await prisma.ticket.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return list.map(mapTicket);
  },

  async listTicketDetails(status) {
    const list = await prisma.ticket.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true },
    });
    return list.map((t): TicketDetail => ({
      ...mapTicket(t),
      user: mapBrief(t.user),
    }));
  },

  async getTicket(id) {
    const t = await prisma.ticket.findUnique({ where: { id } });
    return t ? mapTicket(t) : null;
  },

  async updateTicket(id, data) {
    const t = await prisma.ticket.update({ where: { id }, data });
    return mapTicket(t);
  },

  async createNickRequest(data) {
    const n = await prisma.nickRequest.create({
      data: {
        userId: data.userId,
        oldNick: data.oldNick,
        newNick: data.newNick,
        newNickLower: data.newNickLower,
        reason: data.reason ?? null,
      },
    });
    return mapNickRequest(n);
  },

  async listNickRequests(status) {
    const list = await prisma.nickRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return list.map(mapNickRequest);
  },

  async listNickRequestDetails(status) {
    const list = await prisma.nickRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true },
    });
    return list.map((n): NickRequestDetail => ({
      ...mapNickRequest(n),
      user: mapBrief(n.user),
    }));
  },

  async getNickRequest(id) {
    const n = await prisma.nickRequest.findUnique({ where: { id } });
    return n ? mapNickRequest(n) : null;
  },

  async updateNickRequest(id, data) {
    const n = await prisma.nickRequest.update({ where: { id }, data });
    return mapNickRequest(n);
  },

  // ---------------- audit ----------------
  async writeAudit(data) {
    await prisma.auditLog.create({
      data: {
        actorId: data.actorId ?? null,
        actorTgId: data.actorTgId ? BigInt(data.actorTgId) : null,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        meta: (data.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: data.ip ?? null,
      },
    });
  },

  async listAudit(limit = 100) {
    const list = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return list.map(
      (a): AuditLogRec => ({
        id: a.id,
        actorId: a.actorId,
        actorTgId: a.actorTgId !== null ? toStr(a.actorTgId) : null,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        meta: jsonPayload(a.meta) as Record<string, unknown> | null,
        createdAt: a.createdAt,
      })
    );
  },

  async createBroadcast(data) {
    const b = await prisma.broadcast.create({
      data: { text: data.text, createdBy: data.createdBy ?? null },
    });
    return { id: b.id };
  },

  async updateBroadcast(id, data) {
    await prisma.broadcast.update({ where: { id }, data });
  },

  // ---------------- stats ----------------
  async countPaymentsByStatus(status) {
    return prisma.payment.count({ where: { status } });
  },

  async sumPaidAmount(seasonId) {
    const agg = await prisma.payment.aggregate({
      where: { status: "PAID", ...(seasonId ? { seasonId } : {}) },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  },

  async countPaid(seasonId) {
    return prisma.payment.count({
      where: { status: "PAID", ...(seasonId ? { seasonId } : {}) },
    });
  },

  async countPaidByType(type, seasonId) {
    return prisma.payment.count({
      where: { status: "PAID", type, ...(seasonId ? { seasonId } : {}) },
    });
  },
};
