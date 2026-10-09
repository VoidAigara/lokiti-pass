import { AUDIT_ACTIONS, formatKopecks, validateMcNick } from "@loki/shared";
import type { PaymentRec, PlayerRec, SeasonRec } from "./types.js";
import type { Deps } from "./ports.js";
import { nowOf } from "./ports.js";
import { ServiceError } from "./payments.js";

export interface SeasonActor {
  actorId: string;
  actorTgId: string;
  ip?: string;
}

/**
 * «Объявить вайп / новый сезон».
 *  1. Закрываем текущий активный сезон.
 *  2. Создаём новый (номер + 1) с заданными ценами.
 *  3. У всех игроков забираем доступ: статус EXPIRED + whitelist remove.
 *     Старые ники при этом остаются в БД — история сохраняется.
 */
export async function declareWipe(
  deps: Deps,
  input: {
    name: string;
    priceNew: number;
    priceRenew: number;
    actor: SeasonActor;
  }
): Promise<SeasonRec> {
  const { store } = deps;

  const name = input.name.trim();
  if (name.length < 2) {
    throw new ServiceError("VALIDATION", "Название сезона слишком короткое.");
  }
  if (input.priceNew <= 0 || input.priceRenew <= 0) {
    throw new ServiceError("VALIDATION", "Цены должны быть больше нуля.");
  }
  if (input.priceRenew >= input.priceNew) {
    throw new ServiceError(
      "VALIDATION",
      "Цена продления не может быть больше первичной проходки."
    );
  }

  const current = await store.getActiveSeason();
  const all = await store.listSeasons();
  const nextNumber = (all[0]?.number ?? 0) + 1;

  if (current) await store.closeSeason(current.id);
  await store.deactivateAllSeasons();

  const season = await store.createSeason({
    number: nextNumber,
    name,
    priceNew: input.priceNew,
    priceRenew: input.priceRenew,
    activate: true,
  });

  // забираем доступ у всех, у кого он был
  const players = await store.listAllPlayers();
  const affected = players.filter(
    (p) => p.status === "ACTIVE" || p.status === "PENDING"
  );

  for (const p of affected) {
    await store.revokeAccess({ playerId: p.id, seasonId: p.currentSeasonId });
    await store.updatePlayer(p.id, {
      status: "EXPIRED",
      currentSeasonId: null,
    });
    await deps.queue.enqueueRemove({
      action: "whitelist_remove",
      playerId: p.id,
      nick: p.mcNick,
      seasonId: p.currentSeasonId,
      reason: `wipe → season ${season.number}`,
    });
  }

  await store.writeAudit({
    actorId: input.actor.actorId,
    actorTgId: input.actor.actorTgId,
    action: AUDIT_ACTIONS.SEASON_WIPE,
    entity: "Season",
    entityId: season.id,
    meta: {
      number: season.number,
      name: season.name,
      revokedPlayers: affected.length,
      prevSeason: current?.number ?? null,
    },
    ip: input.actor.ip,
  });

  return season;
}

/** Закрыть сезон без объявления нового (сервер уходит на паузу). */
export async function closeSeason(
  deps: Deps,
  seasonId: string,
  actor: SeasonActor
): Promise<void> {
  const season = await deps.store.getSeasonById(seasonId);
  if (!season) throw new ServiceError("NOT_FOUND", "Сезон не найден.");
  await deps.store.closeSeason(seasonId);
  await deps.store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.SEASON_CLOSE,
    entity: "Season",
    entityId: seasonId,
    meta: { number: season.number },
    ip: actor.ip,
  });
}

export async function setSeasonPrices(
  deps: Deps,
  seasonId: string,
  prices: { priceNew: number; priceRenew: number },
  actor: SeasonActor
): Promise<SeasonRec> {
  const season = await deps.store.getSeasonById(seasonId);
  if (!season) throw new ServiceError("NOT_FOUND", "Сезон не найден.");
  if (prices.priceNew <= 0 || prices.priceRenew <= 0) {
    throw new ServiceError("VALIDATION", "Цены должны быть больше нуля.");
  }
  const updated = await deps.store.updateSeason(seasonId, {
    priceNew: prices.priceNew,
    priceRenew: prices.priceRenew,
  });
  await deps.store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.PRICE_CHANGE,
    entity: "Season",
    entityId: seasonId,
    meta: { from: { priceNew: season.priceNew, priceRenew: season.priceRenew }, to: prices },
    ip: actor.ip,
  });
  return updated;
}

export async function banPlayer(
  deps: Deps,
  nickLower: string,
  reason: string,
  actor: SeasonActor
): Promise<PlayerRec> {
  const player = await deps.store.getPlayerByNickLower(nickLower.toLowerCase());
  if (!player) throw new ServiceError("NOT_FOUND", "Игрок с таким ником не найден.");
  if (!reason || reason.trim().length < 3) {
    throw new ServiceError("VALIDATION", "Укажи причину бана.");
  }

  await deps.store.updatePlayer(player.id, {
    status: "BANNED",
    banReason: reason,
    bannedAt: nowOf(deps),
  });

  await deps.queue.enqueueRemove({
    action: "whitelist_remove",
    playerId: player.id,
    nick: player.mcNick,
    seasonId: player.currentSeasonId,
    reason: `ban: ${reason}`,
  });

  await deps.store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.PLAYER_BAN,
    entity: "Player",
    entityId: player.id,
    meta: { nick: player.mcNick, reason },
    ip: actor.ip,
  });

  return { ...player, status: "BANNED", banReason: reason };
}

export async function unbanPlayer(
  deps: Deps,
  nickLower: string,
  actor: SeasonActor
): Promise<PlayerRec> {
  const player = await deps.store.getPlayerByNickLower(nickLower.toLowerCase());
  if (!player) throw new ServiceError("NOT_FOUND", "Игрок не найден.");

  const season = await deps.store.getActiveSeason();
  const hasAccess = season
    ? (await deps.store.countPaidSeasons(player.id)) > 0 &&
      player.currentSeasonId === season.id
    : false;

  const updated = await deps.store.updatePlayer(player.id, {
    status: hasAccess ? "ACTIVE" : "EXPIRED",
    banReason: null,
    bannedAt: null,
  });

  await deps.store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.PLAYER_UNBAN,
    entity: "Player",
    entityId: player.id,
    meta: { nick: player.mcNick },
    ip: actor.ip,
  });

  return updated;
}

/**
 * Одобрение смены ника: меняем ник в БД, переносим в whitelist
 * (сначала add нового, потом remove старого — чтобы не потерять доступ).
 */
export async function approveNickChange(
  deps: Deps,
  requestId: string,
  actor: SeasonActor
): Promise<{ player: PlayerRec; oldNick: string; newNick: string }> {
  const { store } = deps;
  const req = await store.getNickRequest(requestId);
  if (!req) throw new ServiceError("NOT_FOUND", "Заявка не найдена.");
  if (req.status !== "OPEN") {
    throw new ServiceError("CONFLICT", `Заявка уже обработана: ${req.status}.`);
  }

  const v = validateMcNick(req.newNick);
  if (!v.ok) throw new ServiceError("VALIDATION", v.reason);

  const player = await store.getPlayerByUserId(req.userId);
  if (!player) throw new ServiceError("NOT_FOUND", "У пользователя нет привязанного ника.");

  const taken = await store.getPlayerByNickLower(v.nickLower);
  if (taken && taken.id !== player.id) {
    throw new ServiceError("NICK_TAKEN", "Ник уже занят другим игроком.");
  }

  const oldNick = player.mcNick;

  await store.updatePlayer(player.id, {
    mcNick: v.nick,
    mcNickLower: v.nickLower,
  });

  await store.updateNickRequest(req.id, {
    status: "APPROVED",
    note: `by admin ${actor.actorTgId}`,
    resolvedAt: nowOf(deps),
  });

  if (player.status === "ACTIVE") {
    await deps.queue.enqueueAdd({
      action: "whitelist_add",
      paymentId: "",
      playerId: player.id,
      nick: v.nick,
      seasonId: player.currentSeasonId ?? "",
    });
    await deps.queue.enqueueRemove({
      action: "whitelist_remove",
      playerId: player.id,
      nick: oldNick,
      seasonId: player.currentSeasonId,
      reason: "nick change",
    });
  }

  await store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.PLAYER_NICK_CHANGE,
    entity: "Player",
    entityId: player.id,
    meta: { oldNick, newNick: v.nick, requestId: req.id },
    ip: actor.ip,
  });

  return { player: { ...player, mcNick: v.nick, mcNickLower: v.nickLower }, oldNick, newNick: v.nick };
}

export async function rejectNickChange(
  deps: Deps,
  requestId: string,
  note: string,
  actor: SeasonActor
): Promise<void> {
  const { store } = deps;
  const req = await store.getNickRequest(requestId);
  if (!req) throw new ServiceError("NOT_FOUND", "Заявка не найдена.");
  await store.updateNickRequest(req.id, {
    status: "REJECTED",
    note: note || "отклонено модератором",
    resolvedAt: nowOf(deps),
  });
  await store.writeAudit({
    actorId: actor.actorId,
    actorTgId: actor.actorTgId,
    action: AUDIT_ACTIONS.TICKET_RESOLVE,
    entity: "NickRequest",
    entityId: req.id,
    meta: { decision: "REJECTED", note },
    ip: actor.ip,
  });
}

export interface StatsResult {
  season: SeasonRec | null;
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
  recentPayments: PaymentRec[];
}

export async function getStats(deps: Deps): Promise<StatsResult> {
  const { store } = deps;
  const season = await store.getActiveSeason();

  const [
    revenue,
    paidCount,
    newCount,
    renewCount,
    active,
    expired,
    banned,
    pending,
    refunded,
    recent,
  ] = await Promise.all([
    store.sumPaidAmount(season?.id ?? null),
    store.countPaid(season?.id ?? null),
    store.countPaidByType("NEW", season?.id ?? null),
    store.countPaidByType("RENEW", season?.id ?? null),
    store.countPlayersByStatus("ACTIVE"),
    store.countPlayersByStatus("EXPIRED"),
    store.countPlayersByStatus("BANNED"),
    store.countPaymentsByStatus("PENDING"),
    store.countPaymentsByStatus("REFUNDED"),
    store.listPayments({ limit: 15 }),
  ]);

  const created = paidCount + pending + refunded;
  return {
    season,
    totals: {
      paidRevenueKopecks: revenue,
      paidCount,
      newCount,
      renewCount,
      activePlayers: active,
      expiredPlayers: expired,
      bannedPlayers: banned,
      pendingPayments: pending,
      refundedCount: refunded,
    },
    conversion: {
      created,
      paid: paidCount,
      rate: created > 0 ? Math.round((paidCount / created) * 100) : 0,
    },
    recentPayments: recent,
  };
}

export function formatSeasonSummary(s: SeasonRec): string {
  return `Сезон #${s.number} «${s.name}» — новая ${formatKopecks(s.priceNew)}, продление ${formatKopecks(s.priceRenew)}`;
}
