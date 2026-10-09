import { describe, expect, it } from "vitest";
import { computeOffer } from "../src/pricing.js";
import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
} from "../src/constants.js";

const season = {
  id: "s5",
  number: 5,
  name: "Сезон 5",
  isActive: true,
  priceNew: 50_000,
  priceRenew: 20_000,
};

const closedSeason = { ...season, id: "s4", isActive: false };

const neverPaid = {
  status: "PENDING" as const,
  currentSeasonId: null,
  paidSeasons: 0,
};

const returningPlayer = {
  status: "PENDING" as const,
  currentSeasonId: null,
  paidSeasons: 1,
};

const activePlayer = {
  status: "ACTIVE" as const,
  currentSeasonId: "s5",
  paidSeasons: 1,
};

const bannedPlayer = {
  status: "BANNED" as const,
  currentSeasonId: "s5",
  paidSeasons: 1,
};

describe("computeOffer — единственное место расчёта цены", () => {
  it("новый игрок платит полную цену (копейки)", () => {
    const offer = computeOffer(season, neverPaid);
    expect(offer.kind).toBe("NEW");
    expect(offer.type).toBe("NEW");
    expect(offer.amount).toBe(50_000);
    expect(offer.amount).toBe(DEFAULT_PRICE_NEW_KOPECKS);
  });

  it("игрок, плативший раньше, после вайпа платит продление", () => {
    const offer = computeOffer(season, returningPlayer);
    expect(offer.kind).toBe("RENEW");
    expect(offer.type).toBe("RENEW");
    expect(offer.amount).toBe(20_000);
    expect(offer.amount).toBe(DEFAULT_PRICE_RENEW_KOPECKS);
  });

  it("доступ в текущем сезоне — платить нечего", () => {
    const offer = computeOffer(season, activePlayer);
    expect(offer.kind).toBe("ALREADY_ACTIVE");
    expect(offer.amount).toBe(0);
  });

  it("нет активного сезона — NO_SEASON", () => {
    expect(computeOffer(closedSeason, returningPlayer).kind).toBe("NO_SEASON");
    expect(computeOffer(null, neverPaid).kind).toBe("NO_SEASON");
    expect(computeOffer(null, neverPaid).amount).toBe(0);
  });

  it("забаненный не может купить проходку", () => {
    const offer = computeOffer(season, bannedPlayer);
    expect(offer.kind).toBe("NO_SEASON");
    expect(offer.amount).toBe(0);
    expect(offer.reason).toMatch(/заблокирован/i);
  });

  it("игрок без записи о платежах после вайпа снова платит 500 ₽", () => {
    // вайп: сезон новый, у игрока не было ни одной оплаченной PlayerSeason
    const afterWipe = {
      status: "EXPIRED" as const,
      currentSeasonId: "s4",
      paidSeasons: 0,
    };
    const offer = computeOffer(season, afterWipe);
    expect(offer.kind).toBe("NEW");
    expect(offer.amount).toBe(50_000);
  });

  it("цена берётся из сезона, а не захардкожена", () => {
    const custom = { ...season, priceNew: 70_000, priceRenew: 35_000 };
    expect(computeOffer(custom, neverPaid).amount).toBe(70_000);
    expect(computeOffer(custom, returningPlayer).amount).toBe(35_000);
  });
});
