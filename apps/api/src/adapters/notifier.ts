import { formatKopecks } from "@loki/shared";
import { env } from "../config.js";
import { sendMessage } from "../lib/telegram.js";
import type { Notifier } from "../services/ports.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const telegramNotifier: Notifier = {
  async accessGranted(tgId, info) {
    const text = [
      "✅ <b>Доступ выдан!</b>",
      "",
      `Ник: <code>${escapeHtml(info.nick)}</code>`,
      `Сезон: ${escapeHtml(info.seasonName)}`,
      "",
      "Заходи на сервер:",
      `<code>${escapeHtml(info.ip)}</code>`,
      "",
      "_Whitelist добавлен автоматически._",
    ].join("\n");

    await sendMessage(Number(tgId), text, {
      replyMarkup: {
        inline_keyboard: [
          [{ text: "👤 Профиль", url: `${env.WEB_URL}/profile` }],
        ],
      },
    });
  },

  async accessRevoked(tgId, info) {
    await sendMessage(
      Number(tgId),
      [
        "♻️ <b>Доступ приостановлен</b>",
        "",
        `Ник: <code>${escapeHtml(info.nick)}</code>`,
        `Причина: ${escapeHtml(info.reason)}`,
        "",
        "Продли проходку, чтобы вернуться на сервер.",
      ].join("\n")
    );
  },

  async paymentRefunded(tgId, info) {
    await sendMessage(
      Number(tgId),
      [
        "💸 <b>Возврат оформлен</b>",
        "",
        `Сумма: ${formatKopecks(info.amount)}`,
        `Причина: ${escapeHtml(info.reason)}`,
        "",
        "Деньги придут на тот же способ оплаты в течение 3–5 рабочих дней.",
      ].join("\n")
    );
  },

  async paymentFailed(tgId, info) {
    await sendMessage(
      Number(tgId),
      [
        "⚠️ <b>Платёж не прошёл</b>",
        "",
        escapeHtml(info.message),
        "",
        "Попробуй ещё раз командой /buy.",
      ].join("\n")
    );
  },

  async broadcast(tgId, html) {
    await sendMessage(Number(tgId), html, { parseMode: "HTML" });
  },
};
