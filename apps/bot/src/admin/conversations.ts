import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../context.js";
import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
  formatKopecks,
  parseRubToKopecks,
} from "@loki/shared";
import { callApi, humanApiError, isAdminCtx } from "../helpers.js";
import { mainKeyboard, cancelKeyboard, BTN } from "../texts.js";
import { renderPayment } from "./render.js";
import type { AdminPaymentsResponse, AdminStatsResponse } from "../types.js";

type Ctx = BotContext;

/** Конверсации админки: вход только для админа (backstop поверх API 403). */
async function ensureAdmin(ctx: Ctx): Promise<boolean> {
  if (isAdminCtx(ctx)) return true;
  await ctx.reply("⛔ Нет доступа.", { reply_markup: mainKeyboard });
  return false;
}

async function askText(
  conversation: Conversation<Ctx>,
  ctx: Ctx,
  prompt: string
): Promise<string | null> {
  await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: cancelKeyboard });
  for (let i = 0; i < 4; i++) {
    const next = await conversation.wait();
    const text = next.message?.text?.trim();
    if (!text) continue;
    if (text === BTN.cancel || text === "/cancel") {
      await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
      return null;
    }
    if (text.startsWith("/")) {
      await ctx.reply("Отправь ответ текстом или нажми ✖️ Отмена.");
      continue;
    }
    return text;
  }
  await ctx.reply("Слишком много попыток. Начни заново.", {
    reply_markup: mainKeyboard,
  });
  return null;
}

async function askConfirm(conversation: Conversation<Ctx>, ctx: Ctx): Promise<boolean> {
  const answer = await askText(
    conversation,
    ctx,
    "Подтверди: <b>Да</b> или <b>Нет</b>"
  );
  return (answer ?? "").trim().toLowerCase().startsWith("д");
}

/** 🎬 Объявить вайп / новый сезон. */
export async function wipeConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  if (!(await ensureAdmin(ctx))) return;
  const stats = await callApi<AdminStatsResponse>(ctx, "/admin/stats");
  await ctx.reply(
    [
      "🎬 <b>Объявить вайп / новый сезон</b>",
      "",
      `Текущий: ${
        stats.season
          ? `#${stats.season.number} — ${escape(stats.season.name)}`
          : "не объявлен"
      }`,
      `Активных игроков сейчас: <b>${stats.totals.activePlayers}</b>`,
      "",
      "⚠️ Всем активным игрокам доступ будет отключён до оплаты продления.",
    ].join("\n"),
    { parse_mode: "HTML" }
  );

  const name = await askText(conversation, ctx, "1️⃣ Название сезона (напр. «Осень 2026»):");
  if (!name) return;

  const priceNewRaw = await askText(
    conversation,
    ctx,
    `2️⃣ Цена новой проходки в рублях (Enter = <b>500</b>):`
  );
  if (priceNewRaw === null) return;
  const renewRaw = await askText(
    conversation,
    ctx,
    `3️⃣ Цена продления в рублях (Enter = <b>200</b>):`
  );
  if (renewRaw === null) return;

  let priceNew = DEFAULT_PRICE_NEW_KOPECKS;
  let priceRenew = DEFAULT_PRICE_RENEW_KOPECKS;
  try {
    if (priceNewRaw.trim()) priceNew = parseRubToKopecks(priceNewRaw);
    if (renewRaw.trim()) priceRenew = parseRubToKopecks(renewRaw);
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
    return;
  }

  await ctx.reply(
    [
      "Проверь:",
      `• Сезон: <b>${escape(name)}</b>`,
      `• Новая: <b>${formatKopecks(priceNew)}</b>`,
      `• Продление: <b>${formatKopecks(priceRenew)}</b>`,
      `• Будет отключён доступ у <b>${stats.totals.activePlayers}</b> игроков`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );

  if (!(await askConfirm(conversation, ctx))) {
    await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
    return;
  }

  try {
    const res = await callApi<{ season: { number: number; name: string } }>(
      ctx,
      "/admin/seasons/wipe",
      {
        method: "POST",
        body: { name, priceNew, priceRenew },
      }
    );
    await ctx.reply(
      [
        "✅ <b>Новый сезон объявлен</b>",
        `#${res.season.number} — ${escape(res.season.name)}`,
        "",
        "Игроки получат уведомление о необходимости продления.",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

/** 🚫 Бан ника. */
export async function banConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  if (!(await ensureAdmin(ctx))) return;
  const nick = await askText(conversation, ctx, "🚫 Введи ник для бана:");
  if (!nick) return;
  const reason = await askText(conversation, ctx, "Причина бана:");
  if (!reason) return;

  if (!(await askConfirm(conversation, ctx))) {
    await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
    return;
  }

  try {
    await callApi(ctx, "/admin/players/ban", {
      method: "POST",
      body: { nick, reason },
    });
    await ctx.reply(
      `🔴 <code>${escape(nick)}</code> забанен. Доступ отключён.`,
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

export async function unbanConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  if (!(await ensureAdmin(ctx))) return;
  const nick = await askText(conversation, ctx, "🟢 Введи ник для разбана:");
  if (!nick) return;
  try {
    await callApi(ctx, "/admin/players/unban", {
      method: "POST",
      body: { nick },
    });
    await ctx.reply(`🟢 <code>${escape(nick)}</code> разбанен.`, {
      parse_mode: "HTML",
      reply_markup: mainKeyboard,
    });
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

/** 💸 Возврат по платежу. */
export async function refundConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  if (!(await ensureAdmin(ctx))) return;
  const list = await callApi<AdminPaymentsResponse>(
    ctx,
    "/admin/payments?status=PAID&limit=10"
  );

  if (list.payments.length === 0) {
    await ctx.reply("Нет оплаченных платежей.", { reply_markup: mainKeyboard });
    return;
  }

  await ctx.reply(
    "💸 <b>Выбери платёж по номеру</b>\n\n" +
      list.payments
        .map(
          (p, i) =>
            `${i + 1}. ${formatKopecks(p.amount)} · ${p.type} · ${escape(
              (p.description ?? "").slice(0, 40)
            )}`
        )
        .join("\n"),
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  const numText = await askText(conversation, ctx, "Номер платежа:");
  if (!numText) return;
  const idx = Number(numText) - 1;
  const payment = list.payments[idx];
  if (!payment) {
    await ctx.reply("Нет такого номера.", { reply_markup: mainKeyboard });
    return;
  }

  await ctx.reply(renderPayment(payment), { parse_mode: "HTML" });
  const reason = await askText(conversation, ctx, "Причина возврата (обязательно):");
  if (!reason) return;

  const confirmed = await askConfirm(conversation, ctx);
  if (!confirmed) {
    await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
    return;
  }

  try {
    await callApi(ctx, `/admin/payments/${payment.id}/refund`, {
      method: "POST",
      body: { reason },
    });
    await ctx.reply(
      `💸 Возврат <b>${formatKopecks(payment.amount)}</b> оформлен.\nДоступ игрока отключён.`,
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

/** 📢 Рассылка по игрокам. */
export async function broadcastConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  if (!(await ensureAdmin(ctx))) return;
  await ctx.reply(
    "📢 Пришли текст рассылки (HTML разрешён).",
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  let text: string | null = null;
  for (let i = 0; i < 3; i++) {
    const next = await conversation.wait();
    const t = next.message?.text;
    if (!t) continue;
    if (t === BTN.cancel || t === "/cancel") {
      await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
      return;
    }
    if (t.length < 2) {
      await ctx.reply("Сообщение слишком короткое.");
      continue;
    }
    text = t;
    break;
  }
  if (!text) return;

  const stats = await callApi<AdminStatsResponse>(ctx, "/admin/stats");
  await ctx.reply(
    [
      `Рассылка уйдёт <b>${stats.totals.activePlayers}</b> активным игрокам.`,
      "",
      "Предпросмотр:",
      text,
    ].join("\n"),
    { parse_mode: "HTML" }
  );

  if (!(await askConfirm(conversation, ctx))) {
    await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
    return;
  }

  try {
    const res = await callApi<{ sent: number; failed: number }>(
      ctx,
      "/admin/broadcast",
      { method: "POST", body: { text, target: "ACTIVE" } }
    );
    await ctx.reply(
      `✅ Рассылка завершена: доставлено ${res.sent}, ошибок ${res.failed}.`,
      { reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
