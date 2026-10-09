export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "NO_SEASON"
  | "ALREADY_ACTIVE"
  | "NICK_TAKEN"
  | "PAYMENT_FAILED"
  | "INTERNAL";

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type PlayerStatusDto = "ACTIVE" | "EXPIRED" | "PENDING" | "BANNED";

export interface SeasonDto {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
  priceNew: number;
  priceRenew: number;
  startedAt: string;
  endedAt: string | null;
}

export interface OfferDto {
  kind: "NEW" | "RENEW" | "ALREADY_ACTIVE" | "NO_SEASON";
  amount: number;
  type: "NEW" | "RENEW";
  reason?: string;
  season: SeasonDto | null;
}

export interface PlayerDto {
  mcNick: string;
  status: PlayerStatusDto;
  currentSeason: SeasonDto | null;
  totalPaid: number;
  renewalCount: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  banReason?: string | null;
}

export interface PaymentDto {
  id: string;
  amount: number;
  currency: string;
  type: "NEW" | "RENEW" | "TOPUP";
  provider: "YOOKASSA" | "STARS" | "MANUAL";
  status: "PENDING" | "PAID" | "REFUNDED" | "FAILED" | "CANCELED";
  description: string | null;
  confirmationUrl: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  seasonNumber: number | null;
}

export interface MeResponse {
  user: {
    id: string;
    tgId: string;
    tgUsername: string | null;
    firstName: string | null;
    isAdmin: boolean;
  };
  player: PlayerDto | null;
  offer: OfferDto;
  payments: PaymentDto[];
}

export interface CreatePaymentRequest {
  type?: "NEW" | "RENEW";
  /** Если игрок ещё не привязал ник — приходит отсюда. */
  mcNick?: string;
}

export interface CreatePaymentResponse {
  paymentId: string;
  confirmationUrl: string | null;
  /** Для Telegram Stars — payload инвойса. */
  starsInvoice?: {
    title: string;
    description: string;
    amount: number; // в копейках
    currency: string;
    payload: string;
  };
  offer: OfferDto;
}

export interface AdminStats {
  season: SeasonDto | null;
  totals: {
    paidRevenueKopecks: number;
    paidCount: number;
    newCount: number;
    renewCount: number;
    refundedKopecks: number;
    refundedCount: number;
    activePlayers: number;
    expiredPlayers: number;
    bannedPlayers: number;
    pendingPayments: number;
  };
  conversion: {
    created: number;
    paid: number;
    rate: number;
  };
  last14Days: Array<{ date: string; paid: number; revenue: number }>;
  recentPayments: PaymentDto[];
}

export interface AdminPlayerDto extends PlayerDto {
  id: string;
  tgId: string;
  tgUsername: string | null;
  firstName: string | null;
  createdAt: string;
}

export interface TicketDto {
  id: string;
  type: "NICK_CHANGE" | "SUPPORT" | "REFUND_REQUEST";
  status: "OPEN" | "APPROVED" | "REJECTED" | "CLOSED";
  payload: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  user: {
    id: string;
    tgId: string;
    tgUsername: string | null;
    firstName: string | null;
  };
  moderator: { id: string; firstName: string | null } | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  checks: Record<string, { ok: boolean; message?: string }>;
}
