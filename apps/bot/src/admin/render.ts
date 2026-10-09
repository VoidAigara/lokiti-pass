import { formatKopecks } from "@loki/shared";
import { escapeHtml } from "../texts.js";
import type {
  AdminStatsResponse,
  NickRequestItem,
  PaymentItem,
  TicketItem,
} from "../types.js";

const STATUS_EMOJI: Record<string, string> = {
  PAID: "✅",
  PENDING: "🕓",
  REFUNDED: "💸",
  FAILED: "❌",
  CANCELED: "🚫",
};

export function renderStats(s: AdminStatsResponse): string {
  const t = s.totals;
  return [
    "📊 <b>Статистика</b>",
    "",
    s.season
      ? `Сезон: <b>#${s.season.number} — ${escapeHtml(s.season.name)}</b>`
      : "Сезон: <i>не объявлен</i>",
    "",
    `💰 Выручка: <b>${formatKopecks(t.paidRevenueKopecks)}</b>`,
    `🧾 Оплаченных: <b>${t.paidCount}</b>  (новых ${t.newCount} / продлений ${t.renewCount})`,
    `🕓 В ожидании: <b>${t.pendingPayments}</b>`,
    `💸 Возвратов: <b>${t.refundedCount}</b>`,
    "",
    `🟢 Активных игроков: <b>${t.activePlayers}</b>`,
    `🟠 Ждут продления: <b>${t.expiredPlayers}</b>`,
    `🔴 Забанено: <b>${t.bannedPlayers}</b>`,
    "",
    `📈 Конверсия созданных платежей: <b>${s.conversion.rate}%</b> (${s.conversion.paid}/${s.conversion.created})`,
  ].join("\n");
}

export function renderPayment(p: PaymentItem): string {
  const who = p.description ?? "—";
  return [
    `${STATUS_EMOJI[p.status] ?? "❔"} <b>${formatKopecks(p.amount)}</b> · ${p.type} · ${p.status}`,
    `🆔 <code>${p.id}</code>`,
    `🧾 ${escapeHtml(who)}`,
    `📅 ${new Date(p.createdAt).toLocaleString("ru-RU")}`,
    p.refundReason ? `↩️ Причина возврата: ${escapeHtml(p.refundReason)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderPaymentsList(
  payments: PaymentItem[],
  offset: number,
  _limit: number
): string {
  if (payments.length === 0) {
    return "Платежей нет.";
  }
  const head = `🧾 <b>Платежи</b> (${offset + 1}–${offset + payments.length})\n`;
  const body = payments
    .map(
      (p, i) =>
        `${offset + i + 1}. ${STATUS_EMOJI[p.status] ?? "❔"} ${formatKopecks(
          p.amount
        )} · ${p.type} · ${escapeHtml(p.description ?? "").slice(0, 40)}`
    )
    .join("\n");
  return head + body;
}

export function renderTicket(t: TicketItem): string {
  return [
    `🎫 <b>${escapeHtml(t.type)}</b> · ${t.status}`,
    `От: ${escapeHtml(t.user.firstName ?? t.user.tgUsername ?? t.user.tgId)}` +
      (t.user.tgUsername ? ` (@${escapeHtml(t.user.tgUsername)})` : ""),
    `🆔 <code>${t.id}</code>`,
    "",
    escapeHtml(String(t.payload.text ?? "").slice(0, 500)),
  ].join("\n");
}

export function renderNickRequest(r: NickRequestItem): string {
  return [
    `🔖 <b>Смена ника</b> · ${r.status}`,
    `От: ${escapeHtml(r.user.firstName ?? r.user.tgUsername ?? r.user.tgId)}`,
    `Было: <code>${escapeHtml(r.oldNick ?? "—")}</code>`,
    `Стало: <code>${escapeHtml(r.newNick)}</code>`,
    `🆔 <code>${r.id}</code>`,
  ].join("\n");
}
