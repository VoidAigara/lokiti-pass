import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../context.js";
import { formatKopecks } from "@loki/shared";
import { botEnv } from "../config.js";
import { callApi, humanApiError } from "../helpers.js";
import { texts, mainKeyboard } from "../texts.js";
import { promptNick } from "./nick.js";
import type { MeResponse, OfferDto, StarsInvoiceResponse } from "../types.js";

type Ctx = BotContext;

type PayButton = { text: string; callback_data: string };
type LinkButton = { text: string; url: string };
type ButtonRow = Array<PayButton | LinkButton>;

function offerButtons(o: OfferDto): { inline_keyboard: ButtonRow[] } {
  const rows: ButtonRow[] = [];
  const payLabel = `💳 Оплатить ${formatKopecks(o.amount)}`;

  if (botEnv.STARS_ENABLED) {
    rows.push([
      { text: `${payLabel} (карта/СБП)`, callback_data: "pay:yookassa" },
      { text: "⭐ Оплатить Stars", callback_data: "pay:stars" },
    ]);
  } else {
    rows.push([{ text: payLabel, callback_data: "pay:yookassa" }]);
  }

  return { inline_keyboard: rows };
}

/**
 * Общий флоу покупки: /buy (NEW) и /renew (RENEW).
 * 1) проверяем ник → 2) показываем оффер → 3) кнопка оплаты → 4) инвойс.
 */
export async function purchaseConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx,
  forceType: "NEW" | "RENEW"
): Promise<void> {
  let me = await callApi<MeResponse>(ctx, "/me");

  // 1) привязка ника при необходимости
  if (!me.player?.mcNick) {
    if (forceType === "RENEW") {
      await ctx.reply(
        "У тебя ещё не было проходки — продление недоступно. Купи первую: /buy",
        { reply_markup: mainKeyboard }
      );
      return;
    }
    const nick = await promptNick(conversation, ctx);
    if (!nick) return;
    try {
      await callApi(ctx, "/me/nick", { method: "POST", body: { mcNick: nick } });
    } catch (err) {
      await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
      return;
    }
    me = await callApi<MeResponse>(ctx, "/me");
  }

  const offer = me.offer;

  // 2) оффер
  await ctx.reply(
    texts.offer(offer, { hasNick: true, nick: me.player?.mcNick ?? undefined }),
    {
      parse_mode: "HTML",
      reply_markup:
        offer.kind === "NEW" || offer.kind === "RENEW"
          ? offerButtons(offer)
          : mainKeyboard,
    }
  );

  if (offer.kind !== "NEW" && offer.kind !== "RENEW") return;

  // 3) ждём нажатия кнопки оплаты
  const cb = await conversation.waitForCallbackQuery(/^pay:(yookassa|stars)$/, {
    otherwise: async (c) => {
      if (c.callbackQuery) await c.answerCallbackQuery().catch(() => undefined);
    },
  });

  const provider = cb.callbackQuery.data.endsWith("stars") ? "stars" : "yookassa";
  await cb.answerCallbackQuery("Создаю платёж…").catch(() => undefined);

  if (provider === "stars") {
    await sendStarsInvoice(ctx, forceType);
    return;
  }

  // 4) ссылка на оплату
  try {
    const res = await callApi<{
      paymentId: string;
      confirmationUrl: string | null;
    }>(ctx, "/payments/create", {
      method: "POST",
      body: { type: forceType },
    });

    if (!res.confirmationUrl) {
      await ctx.reply("Не удалось создать платёж. Попробуй позже.", {
        reply_markup: mainKeyboard,
      });
      return;
    }

    await ctx.reply(
      [
        "💳 <b>Оплата</b>",
        "",
        "Нажми кнопку ниже — откроется страница оплаты.",
        "После оплаты доступ придёт автоматически в течение 30 секунд.",
      ].join("\n"),
      {
        parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `Перейти к оплате ${formatKopecks(offer.amount)}`,
              url: res.confirmationUrl,
            },
          ],
        ],
      },
      }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

/** Отправляет инвойс Telegram Stars (вызывается из сценария покупки и из
 * deep-link /start?start=stars — из Mini App, где нет своей кнопки оплаты). */
export async function sendStarsInvoice(
  ctx: Ctx,
  forceType?: "NEW" | "RENEW"
): Promise<void> {
  try {
    const inv = await callApi<StarsInvoiceResponse>(
      ctx,
      "/payments/stars/invoice",
      { method: "POST", body: forceType ? { type: forceType } : {} }
    );

    // эталон приходит от API — он же используется при сверке при подтверждении
    const stars =
      inv.stars ??
      Math.max(
        1,
        Math.ceil(inv.amount / 100 / botEnv.STARS_RUB_PER_STAR)
      );

    await ctx.replyWithInvoice(
      inv.title ?? "Проходка на сервер Loki Ti",
      "Оплата Telegram Stars. Доступ выдаётся автоматически после подтверждения.",
      inv.payload,
      "XTR",
      [{ label: inv.title ?? "Проходка", amount: stars }],
      { provider_token: "", need_shipping_address: false }
    );
  } catch (err) {
    await ctx.reply(
      `❌ Не удалось создать инвойс Stars: ${humanApiError(err)}`,
      { reply_markup: mainKeyboard }
    );
  }
}

/** Обработка successful_payment (Telegram Stars). */
export async function handleStarsPayment(ctx: Ctx): Promise<void> {
  const msg = ctx.message;
  const sp = msg?.successful_payment;
  if (!msg || !sp) return;

  let paymentId: string | null = null;
  try {
    const parsed = JSON.parse(sp.invoice_payload) as { paymentId?: string };
    paymentId = parsed.paymentId ?? null;
  } catch {
    // битый payload — paymentId остаётся null
  }

  if (!paymentId) {
    await ctx.reply("Не смог определить платёж. Напиши /support.", {
      reply_markup: mainKeyboard,
    });
    return;
  }

  try {
    await callApi(ctx, "/payments/stars", {
      method: "POST",
      body: {
        paymentId,
        telegramPaymentChargeId: sp.telegram_payment_charge_id,
        starsAmount: sp.total_amount,
      },
    });
    await ctx.reply(
      "⭐ Оплата Stars получена! Доступ выдаётся, ожидай уведомление.",
      { reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}
