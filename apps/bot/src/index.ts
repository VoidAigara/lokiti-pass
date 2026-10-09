import "dotenv/config";
import { Bot } from "grammy";
import { conversations, createConversation, type ConversationFn } from "@grammyjs/conversations";
import { BOT_COMMANDS } from "@loki/shared";

import { botEnv, isAdmin } from "./config.js";
import type { BotContext } from "./context.js";
import { errorBoundary, rateLimit } from "./middleware.js";
import { texts, mainKeyboard, BTN } from "./texts.js";
import { callApi, humanApiError } from "./helpers.js";
import { createHealthMonitor } from "./health.js";

import { nickConversation } from "./scenes/nick.js";
import { supportConversation } from "./scenes/support.js";
import {
  purchaseConversation,
  handleStarsPayment,
} from "./scenes/purchase.js";
import { profileHandler, startHandler } from "./scenes/profile.js";

import {
  adminMenu,
  registerMenus,
  showPaymentsPage,
  type AdminCtx,
} from "./admin/menu.js";
import {
  wipeConversation,
  banConversation,
  unbanConversation,
  refundConversation,
  broadcastConversation,
} from "./admin/conversations.js";

const bot = new Bot<BotContext>(botEnv.BOT_TOKEN);

// ---------------------------------------------------------- видимость сети с Telegram
// grammY молча ретраит сбойный getUpdates каждые 3с (логи только с DEBUG=grammy:*)
// — из-за этого бот может часами «не работать» без единой строки в логах.
// Трансформер API логирует первое падение и восстановление.
let telegramDownSince: number | null = null;
bot.api.config.use(async (prev, method, payload) => {
  try {
    const res = await prev(method, payload);
    if (method === "getUpdates" && telegramDownSince !== null) {
      const secs = Math.round((Date.now() - telegramDownSince) / 1000);
      telegramDownSince = null;
      console.log(`[bot] Telegram снова доступен (недоступен был ${secs}с)`);
    }
    return res;
  } catch (err) {
    if (method === "getUpdates" && telegramDownSince === null) {
      telegramDownSince = Date.now();
      console.error(
        "[bot] НЕТ СВЯЗИ С TELEGRAM (getUpdates):",
        err instanceof Error ? err.message : err
      );
    }
    throw err;
  }
});

// ---------------------------------------------------------- middleware
bot.use(errorBoundary);
bot.use(rateLimit);
bot.use(conversations());
registerMenus(bot);

// ---------------------------------------------------------- команды
bot.command("start", startHandler);
bot.command("help", (ctx) =>
  ctx.reply(texts.help, { parse_mode: "HTML", reply_markup: mainKeyboard })
);
bot.command("me", profileHandler);

bot.command("nick", createConversation(nickConversation, "nick"));
bot.command("support", createConversation(supportConversation, "support"));
bot.command(
  "buy",
  createConversation(
    ((c: Parameters<typeof purchaseConversation>[0], ctx: BotContext) =>
      purchaseConversation(c, ctx, "NEW")) satisfies ConversationFn<BotContext>,
    "buy"
  )
);
bot.command(
  "renew",
  createConversation(
    ((c: Parameters<typeof purchaseConversation>[0], ctx: BotContext) =>
      purchaseConversation(c, ctx, "RENEW")) satisfies ConversationFn<BotContext>,
    "renew"
  )
);

// ---------------------------------------------------------- админ-конверсации
bot.use(createConversation(wipeConversation, "wipe"));
bot.use(createConversation(banConversation, "ban"));
bot.use(createConversation(unbanConversation, "unban"));
bot.use(createConversation(refundConversation, "refund"));
bot.use(createConversation(broadcastConversation, "broadcast"));

// ---------------------------------------------------------- главное меню
bot.hears(BTN.buy, (ctx) =>
  ctx.conversation.enter("buy")
);
bot.hears(BTN.renew, (ctx) => ctx.conversation.enter("renew"));
bot.hears(BTN.profile, profileHandler);
bot.hears(BTN.support, (ctx) => ctx.conversation.enter("support"));
bot.hears(BTN.cancel, async (ctx) => {
  await ctx.conversation.exit().catch(() => undefined);
  await ctx.reply("Готово.", { reply_markup: mainKeyboard });
});

// ---------------------------------------------------------- оплата Stars
bot.on("message:successful_payment", handleStarsPayment);

// ---------------------------------------------------------- /admin
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from?.id ?? 0)) {
    await ctx.reply("⛔ Нет доступа.");
    return;
  }
  await ctx.reply("🎛 <b>Панель администратора</b>", {
    parse_mode: "HTML",
    reply_markup: adminMenu,
  });
});

// ---------------------------------------------------------- callbacks админки
bot.callbackQuery(/^adm:root$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "⛔" });
    return;
  }
  if (ctx.callbackQuery.message) {
    await ctx
      .editMessageText("🎛 <b>Панель администратора</b>", {
        parse_mode: "HTML",
        reply_markup: adminMenu,
      })
      .catch(() => undefined);
  }
  await ctx.answerCallbackQuery().catch(() => undefined);
});

bot.callbackQuery(/^adm:pay:(\d+):([A-Z]+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: "⛔" });
  await showPaymentsPage(ctx as AdminCtx, Number(ctx.match[1]), ctx.match[2] as never);
});

bot.callbackQuery(/^adm:payf:([A-Z]+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: "⛔" });
  await showPaymentsPage(ctx as AdminCtx, 0, ctx.match[1] as never);
});

bot.callbackQuery(/^adm:tkt:([^:]+):([A-Z]+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: "⛔" });
  try {
    await callApi(ctx, `/admin/tickets/${encodeURIComponent(ctx.match[1]!)}/resolve`, {
      method: "POST",
      body: { status: ctx.match[2] },
    });
    await ctx.answerCallbackQuery({ text: "✅ Готово" });
    if (ctx.callbackQuery.message) {
      await ctx.deleteMessage().catch(() => undefined);
    }
  } catch (err) {
    await ctx.answerCallbackQuery({ text: humanApiError(err) }).catch(() => undefined);
  }
});

bot.callbackQuery(/^adm:nick:([^:]+):(ok|no)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: "⛔" });
  try {
    const action = ctx.match[2];
    await callApi(
      ctx,
      `/admin/nick-requests/${encodeURIComponent(ctx.match[1]!)}/${action === "ok" ? "approve" : "reject"}`,
      { method: "POST", body: {} }
    );
    await ctx.answerCallbackQuery({
      text: action === "ok" ? "✅ Одобрено" : "❌ Отклонено",
    });
    if (ctx.callbackQuery.message) {
      await ctx.deleteMessage().catch(() => undefined);
    }
  } catch (err) {
    await ctx.answerCallbackQuery({ text: humanApiError(err) }).catch(() => undefined);
  }
});

// ---------------------------------------------------------- fallback
bot.on("message:text", async (ctx) => {
  // подсказка, если пользователь пишет что-то вне диалога
  await ctx.reply(
    "Не понял команду. Используй меню ниже или /help.",
    { reply_markup: mainKeyboard }
  );
});

bot.catch((err) => {
  console.error("[bot] update error:", err.error);
});

// ---------------------------------------------------------- алерты о падении
// Стейт-машина и логика — в health.ts (покрыта тестами).
// up — 200 OK; degraded — API отвечает 503 (RCON/БД деградировали);
// down — транспортный сбой ⇒ алерт после двух отказов подряд.
const alertTarget = botEnv.ALERT_CHAT_ID || [...botEnv.ADMIN_TG_IDS][0] || null;
const healthMonitor = createHealthMonitor({
  url: `${botEnv.API_URL}/health`,
  alertTarget,
  alertFn: async (text) => {
    if (!alertTarget) return;
    await bot.api.sendMessage(Number(alertTarget), text, { parse_mode: "HTML" });
  },
});

// ---------------------------------------------------------- запуск
if (!botEnv.BOT_TOKEN || botEnv.BOT_TOKEN.startsWith("CHANGE_ME")) {
  console.error(
    "[bot] BOT_TOKEN не задан (в .env осталась заглушка). " +
      "Возьмите токен у @BotFather, пропишите BOT_TOKEN в .env и выполните: docker compose restart bot"
  );
  process.exit(1);
}

// stray-промисы не должны молча убивать процесс (Node по умолчанию падает)
process.on("unhandledRejection", (err) => {
  console.error("[bot] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[bot] uncaughtException:", err);
});

let healthTimer: ReturnType<typeof setInterval> | null = null;

bot
  .start({
    onStart: (info) => {
      console.log(`[bot] @${info.username} запущен`);
      void bot.api
        .setMyCommands(BOT_COMMANDS.map((c) => ({ ...c })))
        .catch((err) => console.error("[bot] setMyCommands:", err));
      if (!healthTimer) {
        healthTimer = setInterval(() => void healthMonitor.check(), 60_000);
        void healthMonitor.check();
      }
    },
    drop_pending_updates: botEnv.NODE_ENV === "production",
  })
  .catch((err: unknown) => {
    const code = (err as { error_code?: number } | null)?.error_code;
    console.error("[bot] поллинг завершился фатально:", err);
    if (code === 409) {
      console.error(
        "[bot] 409 Conflict = ВТОРОЙ ЭКЗЕМПЛЯР бота поллит этот же токен " +
          "(проверь контейнер бота на VPS: docker ps | grep bot)"
      );
    }
    // Docker restart: unless-stopped поднимет контейнер заново
    process.exit(1);
  });
