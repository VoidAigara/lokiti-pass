import { Menu } from "@grammyjs/menu";
import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { callApi, humanApiError, isAdminCtx } from "../helpers.js";
import { mainKeyboard } from "../texts.js";
import { renderNickRequest, renderStats, renderTicket } from "./render.js";
import type {
  AdminStatsResponse,
  NickRequestItem,
  TicketItem,
} from "../types.js";

export type AdminCtx = BotContext;

async function answer(ctx: AdminCtx, text?: string): Promise<void> {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCallbackQuery(text ? { text } : {});
  } catch {
    /* ignore */
  }
}

/**
 * Backstop на стороне бота: админ-кнопки могут прийти и не-админу
 * (пересланное сообщение с меню). API всё равно отвергнет (403),
 * но не даём даже заходить в обработчики/конверсации.
 */
async function guardAdmin(ctx: AdminCtx): Promise<boolean> {
  if (isAdminCtx(ctx)) return true;
  await answer(ctx, "⛔ Нет доступа");
  return false;
}

export const seasonsMenu = new Menu<BotContext>("seasons");
export const playersMenu = new Menu<BotContext>("players");
export const adminMenu = new Menu<BotContext>("admin");

// --------------------------------------------------------- корень
adminMenu
  .text("📊 Статистика", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    try {
      const stats = await callApi<AdminStatsResponse>(ctx, "/admin/stats");
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(renderStats(stats), {
          parse_mode: "HTML",
          reply_markup: adminMenu,
        });
      } else {
        await ctx.reply(renderStats(stats), {
          parse_mode: "HTML",
          reply_markup: adminMenu,
        });
      }
      await answer(ctx);
    } catch (err) {
      await answer(ctx, humanApiError(err));
    }
  })
  .text("🧾 Платежи", async (ctx) => {
    await showPaymentsPage(ctx, 0, "PAID");
  })
  .row()
  .submenu("🎬 Сезоны", "seasons")
  .submenu("🚫 Игроки", "players")
  .row()
  .text("💸 Возврат", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    await ctx.conversation.enter("refund");
  })
  .text("📢 Рассылка", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    await ctx.conversation.enter("broadcast");
  })
  .row()
  .text("🎫 Тикеты", async (ctx) => {
    await showTickets(ctx);
  })
  .text("🔖 Смена ника", async (ctx) => {
    await showNickRequests(ctx);
  })
  .row()
  .text("✖️ Закрыть", async (ctx) => {
    if (ctx.callbackQuery?.message) {
      await ctx.deleteMessage().catch(() => undefined);
    } else {
      await answer(ctx);
    }
  });

// --------------------------------------------------------- сезоны
seasonsMenu
  .text("🎬 Объявить вайп", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    await ctx.conversation.enter("wipe");
  })
  .text("🔒 Закрыть сезон", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    try {
      const stats = await callApi<AdminStatsResponse>(ctx, "/admin/stats");
      if (!stats.season) {
        await answer(ctx, "Нет активного сезона");
        return;
      }
      await callApi(ctx, `/admin/seasons/${stats.season.id}/close`, {
        method: "POST",
      });
      await answer(ctx);
      await ctx.reply(`🔒 Сезон #${stats.season.number} закрыт.`, {
        reply_markup: mainKeyboard,
      });
    } catch (err) {
      await answer(ctx, humanApiError(err));
    }
  })
  .row()
  .back("↩️ Назад");

// --------------------------------------------------------- игроки
playersMenu
  .text("🚫 Забанить ник", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    await ctx.conversation.enter("ban");
  })
  .text("🟢 Разбанить ник", async (ctx) => {
    if (!(await guardAdmin(ctx))) return;
    await ctx.conversation.enter("unban");
  })
  .row()
  .back("↩️ Назад");

// --------------------------------------------------------- платежи
export async function showPaymentsPage(
  ctx: AdminCtx,
  offset: number,
  status: "PAID" | "PENDING" | "REFUNDED" | "ALL"
): Promise<void> {
  if (!(await guardAdmin(ctx))) return;
  try {
    const qs = status === "ALL" ? "" : `status=${status}&`;
    const list = await callApi<{
      payments: Array<{
        id: string;
        amount: number;
        status: string;
        type: string;
        description: string | null;
      }>;
    }>(ctx, `/admin/payments?${qs}limit=10&offset=${offset}`);

    const lines = list.payments.length
      ? list.payments
          .map(
            (p, i) =>
              `${offset + i + 1}. ${statusEmoji(p.status)} ${Math.round(
                p.amount / 100
              )} ₽ · ${p.type} · ${escapeText((p.description ?? "").slice(0, 38))}\n   <code>${p.id}</code>`
          )
          .join("\n")
      : "Платежей нет.";

    const nav: Array<Array<{ text: string; callback_data: string }>> = [];
    const row: Array<{ text: string; callback_data: string }> = [];
    if (offset > 0) {
      row.push({ text: "⬅️ Назад", callback_data: `adm:pay:${offset - 10}:${status}` });
    }
    if (list.payments.length === 10) {
      row.push({ text: "Вперёд ➡️", callback_data: `adm:pay:${offset + 10}:${status}` });
    }
    if (row.length) nav.push(row);

    nav.push([
      { text: "✅ Оплаченные", callback_data: "adm:payf:PAID" },
      { text: "🕓 Ожидают", callback_data: "adm:payf:PENDING" },
    ]);
    nav.push([{ text: "↩️ Меню", callback_data: "adm:root" }]);

    const text = `🧾 <b>Платежи</b> — ${status} (${offset + 1}+)\n\n${lines}`;

    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: nav },
      });
      await answer(ctx);
    } else {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: { inline_keyboard: nav } });
    }
  } catch (err) {
    await answer(ctx, humanApiError(err));
  }
}

// --------------------------------------------------------- тикеты
export async function showTickets(ctx: AdminCtx): Promise<void> {
  if (!(await guardAdmin(ctx))) return;
  try {
    const res = await callApi<{ tickets: TicketItem[] }>(
      ctx,
      "/admin/tickets?status=OPEN"
    );
    await answer(ctx);
    if (res.tickets.length === 0) {
      await ctx.reply("🎫 Открытых тикетов нет.", { reply_markup: mainKeyboard });
      return;
    }
    for (const t of res.tickets.slice(0, 10)) {
      await ctx.reply(renderTicket(t), {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Закрыть", callback_data: `adm:tkt:${t.id}:CLOSED` },
              { text: "↩️ Меню", callback_data: "adm:root" },
            ],
          ],
        },
      });
    }
  } catch (err) {
    await answer(ctx, humanApiError(err));
  }
}

// --------------------------------------------------------- смена ника
export async function showNickRequests(ctx: AdminCtx): Promise<void> {
  if (!(await guardAdmin(ctx))) return;
  try {
    const res = await callApi<{ requests: NickRequestItem[] }>(
      ctx,
      "/admin/nick-requests?status=OPEN"
    );
    await answer(ctx);
    if (res.requests.length === 0) {
      await ctx.reply("🔖 Заявок на смену ника нет.", {
        reply_markup: mainKeyboard,
      });
      return;
    }
    for (const r of res.requests.slice(0, 10)) {
      await ctx.reply(renderNickRequest(r), {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Одобрить", callback_data: `adm:nick:${r.id}:ok` },
              { text: "❌ Отклонить", callback_data: `adm:nick:${r.id}:no` },
            ],
            [{ text: "↩️ Меню", callback_data: "adm:root" }],
          ],
        },
      });
    }
  } catch (err) {
    await answer(ctx, humanApiError(err));
  }
}

export function registerMenus(bot: Bot<BotContext>): void {
  bot.use(seasonsMenu);
  bot.use(playersMenu);
  bot.use(adminMenu);
}

function statusEmoji(status: string): string {
  return (
    { PAID: "✅", PENDING: "🕓", REFUNDED: "💸", FAILED: "❌", CANCELED: "🚫" }[
      status
    ] ?? "❔"
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
