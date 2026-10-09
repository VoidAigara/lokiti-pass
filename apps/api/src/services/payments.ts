import { computeOffer, validateMcNick, type Offer } from "@loki/shared";
import type { DomainStore, PaymentRec, PlayerRec, SeasonRec } from "./types.js";
import type { Deps } from "./ports.js";
import { logger } from "../lib/logger.js";

export class ServiceError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT"
      | "NO_SEASON"
      | "ALREADY_ACTIVE"
      | "NICK_TAKEN"
      | "NICK_REQUIRED"
      | "PAYMENT_FAILED"
      | "FORBIDDEN",
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export async function offerFromPlayer(
  store: DomainStore,
  season: SeasonRec | null,
  player: PlayerRec | null
): Promise<Offer> {
  const paidSeasons = player ? await store.countPaidSeasons(player.id) : 0;
  return computeOffer(
    season,
    player
      ? {
          status: player.status,
          currentSeasonId: player.currentSeasonId,
          paidSeasons,
        }
      : null
  );
}

/** Оффер для пользователя (используется в /me и в боте). */
export async function buildOffer(
  store: DomainStore,
  userId: string
): Promise<Offer> {
  const [season, player] = await Promise.all([
    store.getActiveSeason(),
    store.getPlayerByUserId(userId),
  ]);
  return offerFromPlayer(store, season, player);
}

/**
 * Возвращает игрока, создавая при необходимости.
 * Ник валидируется и проверяется на уникальность.
 */
export async function ensurePlayerWithNick(
  store: DomainStore,
  userId: string,
  rawNick: string,
  opts: { allowChange?: boolean } = {}
): Promise<PlayerRec> {
  const v = validateMcNick(rawNick);
  if (!v.ok) throw new ServiceError("VALIDATION", v.reason);

  const existing = await store.getPlayerByUserId(userId);

  if (existing) {
    if (existing.mcNickLower === v.nickLower) return existing;
    if (!opts.allowChange) {
      throw new ServiceError(
        "CONFLICT",
        `У тебя уже привязан ник ${existing.mcNick}. Смена — через тикет /nick.`
      );
    }
    const taken = await store.getPlayerByNickLower(v.nickLower);
    if (taken && taken.userId !== userId) {
      throw new ServiceError("NICK_TAKEN", "Этот ник уже занят.");
    }
    return store.updatePlayer(existing.id, {
      mcNick: v.nick,
      mcNickLower: v.nickLower,
    });
  }

  const taken = await store.getPlayerByNickLower(v.nickLower);
  if (taken) {
    throw new ServiceError(
      "NICK_TAKEN",
      "Этот ник уже привязан к другому аккаунту Telegram."
    );
  }

  return store.createPlayer({
    userId,
    mcNick: v.nick,
    mcNickLower: v.nickLower,
    status: "PENDING",
  });
}

export interface CreatePaymentResult {
  payment: PaymentRec;
  offer: Offer;
  reused: boolean;
}

/**
 * Создание платежа. Идемпотентно: повторный вызов при открытом
 * PENDING-платеже возвращает ту же ссылку, а не плодит дубли.
 */
export async function createPlayerPayment(
  deps: Deps,
  input: {
    userId: string;
    mcNick?: string;
    forceType?: "NEW" | "RENEW";
    /** Провайдер платежа. STARS — без внешнего гейтвэя (инвойс шлёт бот). */
    provider?: "YOOKASSA" | "STARS";
  }
): Promise<CreatePaymentResult> {
  const { store } = deps;
  const provider = input.provider ?? "YOOKASSA";

  const season = await store.getActiveSeason();
  if (!season) {
    throw new ServiceError("NO_SEASON", "Сезон не объявлен. Попробуй позже.");
  }

  let player = await store.getPlayerByUserId(input.userId);

  if (input.mcNick) {
    player = await ensurePlayerWithNick(store, input.userId, input.mcNick);
  }

  if (!player) {
    throw new ServiceError(
      "NICK_REQUIRED",
      "Сначала привяжи Minecraft-ник командой /nick."
    );
  }

  if (player.status === "BANNED") {
    throw new ServiceError(
      "FORBIDDEN",
      `Ник ${player.mcNick} заблокирован: ${player.banReason ?? "причина не указана"}.`
    );
  }

  const offer = await offerFromPlayer(store, season, player);

  if (offer.kind === "ALREADY_ACTIVE") {
    throw new ServiceError(
      "ALREADY_ACTIVE",
      "У тебя уже есть доступ к текущему сезону.",
      { season: season.name }
    );
  }
  if (offer.kind === "NO_SEASON") {
    throw new ServiceError("NO_SEASON", offer.reason ?? "Сезон недоступен.");
  }
  if (input.forceType && input.forceType !== offer.type) {
    throw new ServiceError(
      "CONFLICT",
      input.forceType === "RENEW"
        ? "Продление недоступно — ты ещё не играл в прошлых сезонах."
        : "Проходка уже куплена, доступен только платёж за продление.",
      { expected: offer.type }
    );
  }

  const open = (await store.listUserPayments(input.userId, 20)).find(
    (p) =>
      p.status === "PENDING" &&
      p.provider === provider &&
      p.seasonId === season.id &&
      p.type === offer.type &&
      Date.now() - new Date(p.createdAt).getTime() < 30 * 60 * 1000
  );
  if (open?.confirmationUrl) {
    return { payment: open, offer, reused: true };
  }

  const description =
    offer.type === "RENEW"
      ? `Продление доступа — сезон ${season.number} (${season.name})`
      : `Проходка на сервер Loki Ti — сезон ${season.number} (${season.name})`;

  const idempotencyKey =
    open?.idempotencyKey ?? `pay_${input.userId}_${season.id}_${Date.now()}`;

  const payment = open
    ? await store.updatePayment(open.id, { playerId: player.id })
    : await store.createPayment({
        userId: input.userId,
        seasonId: season.id,
        playerId: player.id,
        amount: offer.amount,
        type: offer.type,
        provider,
        description,
        idempotencyKey,
      });

  if (payment.confirmationUrl) return { payment, offer, reused: true };

  // Stars: внешний гейтвэй не нужен — инвойс XTR отправляет бот,
  // подтверждение придёт через /payments/stars.
  if (provider === "STARS") {
    return { payment, offer, reused: Boolean(open) };
  }

  let created;
  try {
    created = await deps.gateway.create({
      amount: offer.amount,
      description,
      returnUrl: `${deps.webUrl}/profile?payment=${payment.id}`,
      metadata: {
        paymentId: payment.id,
        userId: input.userId,
        seasonId: season.id,
        playerId: player.id,
        type: offer.type,
      },
      idempotencyKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.updatePayment(payment.id, {
      status: "FAILED",
      failureReason: msg,
    });
    // сырой текст гейтвэя не показываем пользователю (может содержать
    // детали провайдера) — он остаётся в логе и в failureReason
    logger.error(
      { err: msg, paymentId: payment.id },
      "gateway.create failed"
    );
    throw new ServiceError(
      "PAYMENT_FAILED",
      "Не удалось создать платёж. Попробуй позже или выбери другой способ оплаты."
    );
  }

  const updated = await store.updatePayment(payment.id, {
    confirmationUrl: created.confirmationUrl,
    providerPaymentId: created.providerPaymentId,
  });

  return { payment: updated, offer, reused: false };
}
