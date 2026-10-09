import { randomUUID } from "node:crypto";
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
} from "../src/services/types.js";
import type { CreatePaymentInput, PaymentStatus, PlayerStatus, TicketStatus, TicketType, PaymentType } from "../src/services/types.js";

interface PlayerSeasonRec {
  playerId: string;
  seasonId: string;
  status: "ACTIVE" | "EXPIRED";
  paidAmount: number;
  grantedAt: Date;
  revokedAt: Date | null;
}

/**
 * In-memory реализация DomainStore для тестов без Postgres.
 * Повторяет семантику store-prisma там, где она важна:
 * markPaymentPaid идемпотентен, grantAccess трогает PlayerSeason + Player.
 */
export class InMemoryStore implements DomainStore {
  users = new Map<string, UserRec>();
  players = new Map<string, PlayerRec>();
  payments = new Map<string, PaymentRec>();
  seasons = new Map<string, SeasonRec>();
  playerSeasons = new Map<string, PlayerSeasonRec>();
  whitelistLogs: WhitelistLogRec[] = [];
  audits: AuditLogRec[] = [];
  tickets = new Map<string, TicketRec>();
  nickRequests = new Map<string, NickRequestRec>();
  sessions = new Map<
    string,
    { id: string; userId: string; expiresAt: Date; tokenHash: string }
  >();

  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private psKey(playerId: string, seasonId: string): string {
    return `${playerId}:${seasonId}`;
  }

  // ---------------- users ----------------
  async findUserByTgId(tgId: string): Promise<UserRec | null> {
    return [...this.users.values()].find((u) => u.tgId === tgId) ?? null;
  }

  async getUserById(id: string): Promise<UserRec | null> {
    return this.users.get(id) ?? null;
  }

  async upsertUser(data: {
    tgId: string;
    tgUsername?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    isAdmin?: boolean;
  }): Promise<UserRec> {
    const existing = await this.findUserByTgId(data.tgId);
    if (existing) {
      const merged: UserRec = {
        ...existing,
        tgUsername: data.tgUsername ?? existing.tgUsername,
        firstName: data.firstName ?? existing.firstName,
        isAdmin: data.isAdmin ?? existing.isAdmin,
      };
      this.users.set(existing.id, merged);
      return merged;
    }
    const user: UserRec = {
      id: this.id("user"),
      tgId: data.tgId,
      tgUsername: data.tgUsername ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      isAdmin: data.isAdmin ?? false,
      isBanned: false,
    };
    this.users.set(user.id, user);
    return user;
  }

  // ---------------- sessions ----------------
  async createSession(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{ id: string }> {
    const id = this.id("session");
    this.sessions.set(data.tokenHash, {
      id,
      userId: data.userId,
      expiresAt: data.expiresAt,
      tokenHash: data.tokenHash,
    });
    return { id };
  }

  async findSessionByHash(
    tokenHash: string
  ): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    return { id: s.id, userId: s.userId, expiresAt: s.expiresAt };
  }

  async deleteSession(id: string): Promise<void> {
    for (const [hash, s] of this.sessions) {
      if (s.id === id) {
        this.sessions.delete(hash);
        break;
      }
    }
  }

  // ---------------- seasons ----------------
  async getActiveSeason(): Promise<SeasonRec | null> {
    return [...this.seasons.values()].find((s) => s.isActive) ?? null;
  }

  async getSeasonById(id: string): Promise<SeasonRec | null> {
    return this.seasons.get(id) ?? null;
  }

  async listSeasons(): Promise<SeasonRec[]> {
    return [...this.seasons.values()];
  }

  async createSeason(data: {
    number: number;
    name: string;
    priceNew: number;
    priceRenew: number;
    activate?: boolean;
  }): Promise<SeasonRec> {
    const season: SeasonRec = {
      id: this.id("season"),
      number: data.number,
      name: data.name,
      isActive: data.activate ?? true,
      priceNew: data.priceNew,
      priceRenew: data.priceRenew,
      startedAt: new Date(),
      endedAt: null,
    };
    if (season.isActive) await this.deactivateAllSeasons();
    this.seasons.set(season.id, season);
    return season;
  }

  async deactivateAllSeasons(): Promise<void> {
    for (const [id, s] of this.seasons) {
      if (s.isActive) this.seasons.set(id, { ...s, isActive: false, endedAt: new Date() });
    }
  }

  async activateSeason(id: string): Promise<void> {
    await this.deactivateAllSeasons();
    const s = this.seasons.get(id);
    if (s) this.seasons.set(id, { ...s, isActive: true });
  }

  async closeSeason(id: string): Promise<void> {
    const s = this.seasons.get(id);
    if (s) this.seasons.set(id, { ...s, isActive: false, endedAt: new Date() });
  }

  async updateSeason(
    id: string,
    data: Partial<Pick<SeasonRec, "name" | "priceNew" | "priceRenew" | "isActive">>
  ): Promise<SeasonRec> {
    const s = this.seasons.get(id);
    if (!s) throw new Error(`season ${id} not found`);
    const next = { ...s, ...data };
    this.seasons.set(id, next);
    return next;
  }

  // ---------------- players ----------------
  async getPlayerByUserId(userId: string): Promise<PlayerRec | null> {
    return [...this.players.values()].find((p) => p.userId === userId) ?? null;
  }

  async getPlayerByNickLower(nickLower: string): Promise<PlayerRec | null> {
    return (
      [...this.players.values()].find((p) => p.mcNickLower === nickLower) ?? null
    );
  }

  async getPlayerById(id: string): Promise<PlayerRec | null> {
    return this.players.get(id) ?? null;
  }

  async countPaidSeasons(playerId: string): Promise<number> {
    return [...this.playerSeasons.values()].filter(
      (ps) => ps.playerId === playerId
    ).length;
  }

  async createPlayer(data: {
    userId: string;
    mcNick: string;
    mcNickLower: string;
    status?: PlayerStatus;
    currentSeasonId?: string | null;
  }): Promise<PlayerRec> {
    const player: PlayerRec = {
      id: this.id("player"),
      userId: data.userId,
      mcNick: data.mcNick,
      mcNickLower: data.mcNickLower,
      status: data.status ?? "PENDING",
      currentSeasonId: data.currentSeasonId ?? null,
      totalPaid: 0,
      renewalCount: 0,
      firstPaidAt: null,
      lastPaidAt: null,
      banReason: null,
      bannedAt: null,
    };
    this.players.set(player.id, player);
    return player;
  }

  async updatePlayer(
    id: string,
    data: Partial<
      Pick<
        PlayerRec,
        | "status"
        | "currentSeasonId"
        | "totalPaid"
        | "renewalCount"
        | "firstPaidAt"
        | "lastPaidAt"
        | "banReason"
        | "bannedAt"
        | "mcNick"
        | "mcNickLower"
      >
    >
  ): Promise<PlayerRec> {
    const p = this.players.get(id);
    if (!p) throw new Error(`player ${id} not found`);
    const next = { ...p, ...data };
    this.players.set(id, next);
    return next;
  }

  async countPlayersByStatus(status: PlayerStatus): Promise<number> {
    return [...this.players.values()].filter((p) => p.status === status).length;
  }

  async listAllPlayers(): Promise<PlayerRec[]> {
    return [...this.players.values()];
  }

  async listActiveNickNames(): Promise<
    Array<{ mcNick: string; mcNickLower: string; userId: string }>
  > {
    return [...this.players.values()]
      .filter((p) => p.status === "ACTIVE")
      .map((p) => ({ mcNick: p.mcNick, mcNickLower: p.mcNickLower, userId: p.userId }));
  }

  // ---------------- payments ----------------
  async createPayment(input: CreatePaymentInput): Promise<PaymentRec> {
    const payment: PaymentRec = {
      id: this.id("pay"),
      userId: input.userId,
      seasonId: input.seasonId,
      playerId: input.playerId,
      amount: input.amount,
      currency: input.currency ?? "RUB",
      type: input.type,
      provider: input.provider,
      providerPaymentId: null,
      confirmationUrl: null,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      status: "PENDING",
      failureReason: null,
      refundReason: null,
      createdAt: new Date(),
      paidAt: null,
      refundedAt: null,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  async getPaymentById(id: string): Promise<PaymentRec | null> {
    return this.payments.get(id) ?? null;
  }

  async getPaymentByProviderId(providerPaymentId: string): Promise<PaymentRec | null> {
    return (
      [...this.payments.values()].find(
        (p) => p.providerPaymentId === providerPaymentId
      ) ?? null
    );
  }

  async listUserPayments(userId: string, limit = 50): Promise<PaymentRec[]> {
    return [...this.payments.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listPayments(opts: {
    limit?: number;
    offset?: number;
    status?: PaymentStatus;
  }): Promise<PaymentRec[]> {
    const list = [...this.payments.values()]
      .filter((p) => (opts.status ? p.status === opts.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50));
  }

  async markPaymentPaid(
    id: string,
    data: { providerPaymentId?: string; paidAt?: Date }
  ): Promise<{ payment: PaymentRec; firstTime: boolean }> {
    const p = this.payments.get(id);
    if (!p) throw new Error(`payment ${id} not found`);
    if (p.status !== "PENDING") return { payment: p, firstTime: false };
    const next: PaymentRec = {
      ...p,
      status: "PAID",
      paidAt: data.paidAt ?? new Date(),
      providerPaymentId: data.providerPaymentId ?? p.providerPaymentId,
    };
    this.payments.set(id, next);
    return { payment: next, firstTime: true };
  }

  async updatePayment(
    id: string,
    data: Partial<
      Pick<
        PaymentRec,
        | "status"
        | "confirmationUrl"
        | "providerPaymentId"
        | "failureReason"
        | "refundReason"
        | "refundedAt"
        | "playerId"
      >
    >
  ): Promise<PaymentRec> {
    const p = this.payments.get(id);
    if (!p) throw new Error(`payment ${id} not found`);
    const next = { ...p, ...data };
    this.payments.set(id, next);
    return next;
  }

  // ---------------- access / whitelist ----------------
  async grantAccess(data: {
    playerId: string;
    seasonId: string;
    amount: number;
    isRenewal: boolean;
  }): Promise<void> {
    const now = new Date();
    const key = this.psKey(data.playerId, data.seasonId);
    this.playerSeasons.set(key, {
      playerId: data.playerId,
      seasonId: data.seasonId,
      status: "ACTIVE",
      paidAmount: data.amount,
      grantedAt: now,
      revokedAt: null,
    });

    const p = this.players.get(data.playerId);
    if (!p) throw new Error(`player ${data.playerId} not found`);
    this.players.set(data.playerId, {
      ...p,
      status: "ACTIVE",
      currentSeasonId: data.seasonId,
      lastPaidAt: now,
      renewalCount: data.isRenewal ? p.renewalCount + 1 : p.renewalCount,
    });
  }

  async revokeAccess(data: {
    playerId: string;
    seasonId: string | null;
  }): Promise<void> {
    if (data.seasonId) {
      const key = this.psKey(data.playerId, data.seasonId);
      const ps = this.playerSeasons.get(key);
      if (ps && ps.status === "ACTIVE") {
        this.playerSeasons.set(key, {
          ...ps,
          status: "EXPIRED",
          revokedAt: new Date(),
        });
      }
    }
    const other = [...this.playerSeasons.values()].find(
      (ps) => ps.playerId === data.playerId && ps.status === "ACTIVE"
    );
    const p = this.players.get(data.playerId);
    if (!p) return;
    this.players.set(data.playerId, {
      ...p,
      status: other ? "ACTIVE" : "EXPIRED",
      currentSeasonId: other ? other.seasonId : null,
    });
  }

  async hasWhitelistLogForPayment(paymentId: string): Promise<boolean> {
    return this.whitelistLogs.some(
      (l) => l.paymentId === paymentId && l.action === "ADD"
    );
  }

  async createWhitelistLog(data: Omit<WhitelistLogRec, "id">): Promise<void> {
    this.whitelistLogs.push({ id: this.id("wl"), ...data });
  }

  async listWhitelistLog(limit = 100): Promise<WhitelistLogRec[]> {
    return this.whitelistLogs.slice(-limit).reverse();
  }

  // ---------------- tickets / nick requests ----------------
  async createTicket(data: {
    userId: string;
    type: TicketType;
    payload: Record<string, unknown>;
  }): Promise<TicketRec> {
    const ticket: TicketRec = {
      id: this.id("ticket"),
      userId: data.userId,
      type: data.type,
      status: "OPEN",
      payload: data.payload,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: new Date(),
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  async listTickets(status?: TicketStatus, userId?: string): Promise<TicketRec[]> {
    return [...this.tickets.values()].filter(
      (t) =>
        (status ? t.status === status : true) &&
        (userId ? t.userId === userId : true)
    );
  }

  async listTicketDetails(status?: TicketStatus): Promise<TicketDetail[]> {
    const list = await this.listTickets(status);
    return list.map((t) => ({ ...t, user: this.brief(t.userId) }));
  }

  async listNickRequestDetails(status?: TicketStatus): Promise<NickRequestDetail[]> {
    const list = await this.listNickRequests(status);
    return list.map((r) => ({ ...r, user: this.brief(r.userId) }));
  }

  async getTicket(id: string): Promise<TicketRec | null> {
    return this.tickets.get(id) ?? null;
  }

  async updateTicket(
    id: string,
    data: Partial<Pick<TicketRec, "status" | "resolutionNote" | "resolvedAt">>
  ): Promise<TicketRec> {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`ticket ${id} not found`);
    const next = { ...t, ...data };
    this.tickets.set(id, next);
    return next;
  }

  async createNickRequest(data: {
    userId: string;
    oldNick: string | null;
    newNick: string;
    newNickLower: string;
    reason?: string | null;
  }): Promise<NickRequestRec> {
    const req: NickRequestRec = {
      id: this.id("nickreq"),
      userId: data.userId,
      oldNick: data.oldNick,
      newNick: data.newNick,
      newNickLower: data.newNickLower,
      reason: data.reason ?? null,
      status: "OPEN",
      note: null,
      createdAt: new Date(),
      resolvedAt: null,
    };
    this.nickRequests.set(req.id, req);
    return req;
  }

  async listNickRequests(status?: TicketStatus): Promise<NickRequestRec[]> {
    return [...this.nickRequests.values()].filter((r) =>
      status ? r.status === status : true
    );
  }

  async getNickRequest(id: string): Promise<NickRequestRec | null> {
    return this.nickRequests.get(id) ?? null;
  }

  async updateNickRequest(
    id: string,
    data: Partial<Pick<NickRequestRec, "status" | "note" | "resolvedAt">>
  ): Promise<NickRequestRec> {
    const r = this.nickRequests.get(id);
    if (!r) throw new Error(`nick request ${id} not found`);
    const next = { ...r, ...data };
    this.nickRequests.set(id, next);
    return next;
  }

  // ---------------- audit ----------------
  async writeAudit(data: {
    actorId?: string | null;
    actorTgId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    meta?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void> {
    this.audits.push({
      id: this.id("audit"),
      actorId: data.actorId ?? null,
      actorTgId: data.actorTgId ?? null,
      action: data.action,
      entity: data.entity,
      entityId: data.entityId ?? null,
      meta: data.meta ?? null,
      createdAt: new Date(),
    });
  }

  async listAudit(limit = 100): Promise<AuditLogRec[]> {
    return this.audits.slice(-limit).reverse();
  }

  // ---------------- broadcast ----------------
  async createBroadcast(data: {
    text: string;
    createdBy?: string | null;
  }): Promise<{ id: string }> {
    void data;
    return { id: this.id("bc") };
  }

  async updateBroadcast(): Promise<void> {
    /* noop */
  }

  // ---------------- stats ----------------
  async countPaymentsByStatus(status: PaymentStatus): Promise<number> {
    return [...this.payments.values()].filter((p) => p.status === status).length;
  }

  async sumPaidAmount(seasonId: string | null): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.status === "PAID" && (seasonId ? p.seasonId === seasonId : true))
      .reduce((sum, p) => sum + p.amount, 0);
  }

  async countPaid(seasonId: string | null): Promise<number> {
    return [...this.payments.values()].filter(
      (p) => p.status === "PAID" && (seasonId ? p.seasonId === seasonId : true)
    ).length;
  }

  async countPaidByType(type: PaymentType, seasonId: string | null): Promise<number> {
    return [...this.payments.values()].filter(
      (p) =>
        p.status === "PAID" &&
        p.type === type &&
        (seasonId ? p.seasonId === seasonId : true)
    ).length;
  }

  private brief(userId: string): UserBrief {
    const u = this.users.get(userId);
    return {
      id: u?.id ?? userId,
      tgId: u?.tgId ?? "0",
      tgUsername: u?.tgUsername ?? null,
      firstName: u?.firstName ?? null,
    };
  }

  /** Хелперы для тестов (не часть DomainStore). */
  seedPlayerSeason(playerId: string, seasonId: string, paidAmount: number): void {
    this.playerSeasons.set(this.psKey(playerId, seasonId), {
      playerId,
      seasonId,
      status: "EXPIRED",
      paidAmount,
      grantedAt: new Date(Date.now() - 86_400_000),
      revokedAt: null,
    });
  }

  activePlayerSeasonCount(playerId: string): number {
    return [...this.playerSeasons.values()].filter(
      (ps) => ps.playerId === playerId && ps.status === "ACTIVE"
    ).length;
  }
}

export function newId(): string {
  return randomUUID();
}
