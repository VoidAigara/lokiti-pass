export type * from "@loki/shared";
export type { ApiError, ApiErrorCode } from "@loki/shared";

import type { SeasonDto } from "@loki/shared";

export interface PublicSeasonResponse {
  season: SeasonDto | null;
  serverIp: string;
  prices: { new: number; renew: number };
}

export interface PublicStatusResponse {
  ok: boolean;
  online: number | null;
  max: number | null;
  serverIp: string;
  version?: string | null;
  hostname?: string | null;
  checkedAt: string;
}

export interface AdminStatsResponse {
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
  conversion: { created: number; paid: number; rate: number };
  recentPayments: import("@loki/shared").PaymentDto[];
  seasons: SeasonDto[];
}

export interface AdminTicketDetail {
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

export interface NickRequestDetail {
  id: string;
  userId: string;
  oldNick: string | null;
  newNick: string;
  status: "OPEN" | "APPROVED" | "REJECTED" | "CLOSED";
  createdAt: string;
  resolvedAt: string | null;
  reason: string | null;
  user: {
    id: string;
    tgId: string;
    tgUsername: string | null;
    firstName: string | null;
  };
}

export interface WhitelistLogEntry {
  id: string;
  action: string;
  mcNick: string;
  ok: boolean;
  message: string | null;
  at: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorTgId: number | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface BroadcastResult {
  id: string;
  sent: number;
  failed: number;
}
