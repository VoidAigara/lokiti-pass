import type { MeResponse, OfferDto, SeasonDto } from "@loki/shared";

export interface AdminStatsResponse {
  season: SeasonDto | null;
  totals: {
    paidRevenueKopecks: number;
    paidCount: number;
    newCount: number;
    renewCount: number;
    activePlayers: number;
    expiredPlayers: number;
    bannedPlayers: number;
    pendingPayments: number;
    refundedCount: number;
  };
  conversion: { created: number; paid: number; rate: number };
  recentPayments: PaymentItem[];
  seasons: SeasonDto[];
}

export interface PaymentItem {
  id: string;
  amount: number;
  currency: string;
  type: "NEW" | "RENEW" | "TOPUP";
  provider: "YOOKASSA" | "STARS" | "MANUAL";
  status: "PENDING" | "PAID" | "REFUNDED" | "FAILED" | "CANCELED";
  description: string | null;
  createdAt: string;
  paidAt: string | null;
  refundReason: string | null;
  seasonNumber: number | null;
}

export interface AdminPaymentsResponse {
  payments: PaymentItem[];
  limit: number;
  offset: number;
}

export interface TicketItem {
  id: string;
  type: string;
  status: string;
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
}

export interface NickRequestItem {
  id: string;
  oldNick: string | null;
  newNick: string;
  reason: string | null;
  status: string;
  createdAt: string;
  user: {
    id: string;
    tgId: string;
    tgUsername: string | null;
    firstName: string | null;
  };
}

export interface StarsInvoiceResponse {
  paymentId: string;
  amount: number;
  /** эталонное число звёзд от API (приоритет над локальным расчётом) */
  stars?: number;
  title: string;
  payload: string;
}

export type { MeResponse, OfferDto, SeasonDto };
