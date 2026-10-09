import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../context.js";
import { validateMcNick } from "@loki/shared";
import { callApi, humanApiError } from "../helpers.js";
import { texts, cancelKeyboard, mainKeyboard, BTN } from "../texts.js";
import type { MeResponse } from "../types.js";

type Ctx = BotContext;

/**
 * Диалог ввода ника. Возвращает валидный ник или null (отмена).
 * Используется и в /nick, и внутри флоу покупки.
 */
export async function promptNick(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<string | null> {
  await ctx.reply(texts.nickPrompt, { parse_mode: "HTML", reply_markup: cancelKeyboard });

  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await conversation.wait();
    const text = next.message?.text?.trim();

    if (!text) continue;
    if (text === BTN.cancel || text === "/cancel") {
      await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
      return null;
    }
    if (text.startsWith("/")) {
      await ctx.reply("Отправь ник текстом или нажми ✖️ Отмена.");
      continue;
    }

    const v = validateMcNick(text);
    if (!v.ok) {
      await ctx.reply(texts.nickInvalid(v.reason), { parse_mode: "HTML" });
      continue;
    }
    return v.nick;
  }

  await ctx.reply("Слишком много попыток. Начни заново через /nick.", {
    reply_markup: mainKeyboard,
  });
  return null;
}

/** Полный флоу /nick: привязка или тикет на смену. */
export async function nickConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx
): Promise<void> {
  const me = await callApi<MeResponse>(ctx, "/me");

  // уже привязан → предлагаем смену через тикет
  if (me.player?.mcNick) {
    await ctx.reply(
      [
        `Твой ник: <code>${me.player.mcNick}</code>`,
        "",
        "Смена ника — через заявку: модератор одобрит её вручную.",
        "Введи новый ник или нажми ✖️ Отмена.",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: cancelKeyboard }
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      const next = await conversation.wait();
      const text = next.message?.text?.trim();
      if (!text) continue;
      if (text === BTN.cancel || text === "/cancel") {
        await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
        return;
      }
      if (text === me.player.mcNick) {
        await ctx.reply("Это твой текущий ник.");
        continue;
      }

      const v = validateMcNick(text);
      if (!v.ok) {
        await ctx.reply(texts.nickInvalid(v.reason), { parse_mode: "HTML" });
        continue;
      }

      try {
        await callApi(ctx, "/me/nick-request", {
          method: "POST",
          body: { newNick: v.nick },
        });
        await ctx.reply(texts.nickChangeTicket(v.nick), {
          parse_mode: "HTML",
          reply_markup: mainKeyboard,
        });
      } catch (err) {
        await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
      }
      return;
    }
    return;
  }

  // ещё не привязан → привязка
  const nick = await promptNick(conversation, ctx);
  if (!nick) return;

  try {
    await callApi(ctx, "/me/nick", { method: "POST", body: { mcNick: nick } });
    await ctx.reply(texts.nickBound(nick), {
      parse_mode: "HTML",
      reply_markup: mainKeyboard,
    });
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}
