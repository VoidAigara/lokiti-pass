import type {
  PaymentProvider,
  PaymentStatus,
  PaymentType,
  PlayerStatus,
  TicketStatus,
  TicketType,
  BroadcastStatus,
} from "@loki/db";

export type {
  PaymentProvider,
  PaymentStatus,
  PaymentType,
  PlayerStatus,
  TicketStatus,
  TicketType,
  BroadcastStatus,
};

export interface UserRec {
  id: string;
  tgId: string;
  tgUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  isBanned: boolean;
}

export interface SeasonRec {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
  priceNew: number;
  priceRenew: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface PlayerRec {
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
}

export interface PaymentRec {
  id: string;
  userId: string;
  seasonId: string | null;
  playerId: string | null;
  amount: number;
  currency: string;
  type: PaymentType;
  provider: PaymentProvider;
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
}

export interface TicketRec {
  id: string;
  userId: string;
  type: TicketType;
  status: TicketStatus;
  payload: Record<string, unknown>;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface NickRequestRec {
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
}

export interface UserBrief {
  id: string;
  tgId: string;
  tgUsername: string | null;
  firstName: string | null;
}

export interface TicketDetail extends TicketRec {
  user: UserBrief;
}

export interface NickRequestDetail extends NickRequestRec {
  user: UserBrief;
}

export interface AuditLogRec {
  id: string;
  actorId: string | null;
  actorTgId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface WhitelistLogRec {  id: string;
  mcNick: string;
  mcNickLower: string;
  action: "ADD" | "REMOVE";
  actor: "ADMIN" | "SYSTEM" | "BOT" | "RCON_RETRY";
  seasonId: string | null;
  paymentId: string | null;
  note: string | null;
}

export interface CreatePaymentInput {
  userId: string;
  seasonId: string;
  playerId: string | null;
  amount: number;
  currency?: string;
  type: PaymentType;
  provider: PaymentProvider;
  description: string;
  idempotencyKey: string;
}

/**
 * Узкий интерфейс хранилища.
 * Продакшен-реализация — Prisma (store-prisma.ts).
 * Тесты — InMemoryStore, поэтому критичные сценарии
 * (оплата, whitelist, продление, возврат) гоняются без Postgres.
 */
export interface DomainStore {
  // --- users ---
  findUserByTgId(tgId: string): Promise<UserRec | null>;
  getUserById(id: string): Promise<UserRec | null>;
  upsertUser(data: {
    tgId: string;
    tgUsername?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    isAdmin?: boolean;
  }): Promise<UserRec>;

  // --- sessions ---
  createSession(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{ id: string }>;
  findSessionByHash(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: Date } | null>;
  deleteSession(id: string): Promise<void>;

  // --- seasons ---
  getActiveSeason(): Promise<SeasonRec | null>;
  getSeasonById(id: string): Promise<SeasonRec | null>;
  listSeasons(): Promise<SeasonRec[]>;
  createSeason(data: {
    number: number;
    name: string;
    priceNew: number;
    priceRenew: number;
    activate?: boolean;
  }): Promise<SeasonRec>;
  deactivateAllSeasons(): Promise<void>;
  activateSeason(id: string): Promise<void>;
  closeSeason(id: string): Promise<void>;
  updateSeason(
    id: string,
    data: Partial<Pick<SeasonRec, "name" | "priceNew" | "priceRenew" | "isActive">>
  ): Promise<SeasonRec>;

  // --- players ---
  getPlayerByUserId(userId: string): Promise<PlayerRec | null>;
  getPlayerByNickLower(nickLower: string): Promise<PlayerRec | null>;
  getPlayerById(id: string): Promise<PlayerRec | null>;
  countPaidSeasons(playerId: string): Promise<number>;
  createPlayer(data: {
    userId: string;
    mcNick: string;
    mcNickLower: string;
    status?: PlayerStatus;
    currentSeasonId?: string | null;
  }): Promise<PlayerRec>;
  updatePlayer(
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
  ): Promise<PlayerRec>;
  countPlayersByStatus(status: PlayerStatus): Promise<number>;
  listAllPlayers(): Promise<PlayerRec[]>;
  listActiveNickNames(): Promise<Array<{ mcNick: string; mcNickLower: string; userId: string }>>;

  // --- payments ---
  createPayment(input: CreatePaymentInput): Promise<PaymentRec>;
  getPaymentById(id: string): Promise<PaymentRec | null>;
  getPaymentByProviderId(providerPaymentId: string): Promise<PaymentRec | null>;
  listUserPayments(userId: string, limit?: number): Promise<PaymentRec[]>;
  listPayments(opts: { limit?: number; offset?: number; status?: PaymentStatus }): Promise<PaymentRec[]>;
  /**
   * Атомарно переводит PENDING → PAID.
   * Возвращает firstTime=false, если платёж уже был оплачен (повторный вебхук).
   */
  markPaymentPaid(
    id: string,
    data: { providerPaymentId?: string; paidAt?: Date }
  ): Promise<{ payment: PaymentRec; firstTime: boolean }>;
  updatePayment(
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
  ): Promise<PaymentRec>;

  // --- access / whitelist ---
  grantAccess(data: {
    playerId: string;
    seasonId: string;
    amount: number;
    isRenewal: boolean;
  }): Promise<void>;
  revokeAccess(data: { playerId: string; seasonId: string | null }): Promise<void>;
  /** Идемпотентность: был ли уже выдан доступ по этому платежу. */
  hasWhitelistLogForPayment(paymentId: string): Promise<boolean>;
  createWhitelistLog(data: Omit<WhitelistLogRec, "id">): Promise<void>;
  listWhitelistLog(limit?: number): Promise<WhitelistLogRec[]>;

  // --- tickets / nick requests ---
  createTicket(data: {
    userId: string;
    type: TicketType;
    payload: Record<string, unknown>;
  }): Promise<TicketRec>;
  listTickets(status?: TicketStatus, userId?: string): Promise<TicketRec[]>;
  listTicketDetails(status?: TicketStatus): Promise<TicketDetail[]>;
  listNickRequestDetails(status?: TicketStatus): Promise<NickRequestDetail[]>;
  getTicket(id: string): Promise<TicketRec | null>;
  updateTicket(
    id: string,
    data: Partial<Pick<TicketRec, "status" | "resolutionNote" | "resolvedAt">>
  ): Promise<TicketRec>;
  createNickRequest(data: {
    userId: string;
    oldNick: string | null;
    newNick: string;
    newNickLower: string;
    reason?: string | null;
  }): Promise<NickRequestRec>;
  listNickRequests(status?: TicketStatus): Promise<NickRequestRec[]>;
  getNickRequest(id: string): Promise<NickRequestRec | null>;
  updateNickRequest(
    id: string,
    data: Partial<Pick<NickRequestRec, "status" | "note" | "resolvedAt">>
  ): Promise<NickRequestRec>;

  // --- audit ---
  writeAudit(data: {
    actorId?: string | null;
    actorTgId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    meta?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void>;
  listAudit(limit?: number): Promise<AuditLogRec[]>;

  // --- broadcast ---
  createBroadcast(data: { text: string; createdBy?: string | null }): Promise<{ id: string }>;
  updateBroadcast(
    id: string,
    data: Partial<{
      status: BroadcastStatus;
      total: number;
      sent: number;
      failed: number;
      startedAt: Date | null;
      finishedAt: Date | null;
    }>
  ): Promise<void>;

  // --- stats ---
  countPaymentsByStatus(status: PaymentStatus): Promise<number>;
  sumPaidAmount(seasonId: string | null): Promise<number>;
  countPaid(seasonId: string | null): Promise<number>;
  countPaidByType(type: PaymentType, seasonId: string | null): Promise<number>;
}
