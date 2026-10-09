import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
} from "./constants.js";

export type OfferKind = "NEW" | "RENEW" | "ALREADY_ACTIVE" | "NO_SEASON";

export interface SeasonLite {
  id: string;
  number: number;
  name: string;
  isActive: boolean;
  priceNew: number;
  priceRenew: number;
}

export interface PlayerLite {
  status: "ACTIVE" | "EXPIRED" | "PENDING" | "BANNED";
  currentSeasonId: string | null;
  /** Сколько сезонов игрок уже оплатил ранее (включая текущий). */
  paidSeasons: number;
}

export interface Offer {
  kind: OfferKind;
  amount: number; // копейки
  type: "NEW" | "RENEW";
  season: SeasonLite | null;
  reason?: string;
}

/**
 * Единственное место, где считается цена.
 *
 * Правила:
 *  - Есть активный сезон и игрок в нём уже ACTIVE      → ALREADY_ACTIVE
 *  - Игрок ни разу не платил                            → NEW  (priceNew)
 *  - Игрок платил раньше (уже играл) и это новый сезон → RENEW (priceRenew)
 *  - Активного сезона нет                              → NO_SEASON
 *
 * «Уже играл» = у игрока есть хотя бы одна оплаченная запись PlayerSeason.
 * Именно поэтому новый игрок после вайпа снова платит 500 ₽,
 * а вернувшийся — 200 ₽.
 */
export function computeOffer(
  season: SeasonLite | null,
  player: PlayerLite | null
): Offer {
  if (!season || !season.isActive) {
    return {
      kind: "NO_SEASON",
      amount: 0,
      type: "NEW",
      season: season ?? null,
      reason: "Сезон не объявлен. Подпишитесь на анонс вайпа.",
    };
  }

  const priceNew = season.priceNew ?? DEFAULT_PRICE_NEW_KOPECKS;
  const priceRenew = season.priceRenew ?? DEFAULT_PRICE_RENEW_KOPECKS;

  if (player?.status === "BANNED") {
    return {
      kind: "NO_SEASON",
      amount: 0,
      type: "NEW",
      season,
      reason: "Ник заблокирован на сервере. Напишите в поддержку.",
    };
  }

  const isPaidInThisSeason =
    player != null &&
    player.currentSeasonId === season.id &&
    player.status === "ACTIVE";

  if (isPaidInThisSeason) {
    return {
      kind: "ALREADY_ACTIVE",
      amount: 0,
      type: "NEW",
      season,
      reason: "У тебя уже есть доступ к текущему сезону.",
    };
  }

  const hasPlayedBefore = (player?.paidSeasons ?? 0) > 0;

  if (hasPlayedBefore) {
    return {
      kind: "RENEW",
      amount: priceRenew,
      type: "RENEW",
      season,
    };
  }

  return {
    kind: "NEW",
    amount: priceNew,
    type: "NEW",
    season,
  };
}
