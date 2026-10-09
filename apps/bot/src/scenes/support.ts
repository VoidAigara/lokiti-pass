import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../context.js";
import { callApi, humanApiError } from "../helpers.js";
import { texts, cancelKeyboard, mainKeyboard, BTN } from "../texts.js";
import { TICKET_LIMITS } from "@loki/shared";

type Ctx = BotContext;

export async function supportConversation(
  conversation: Conversation<Ctx>,
  ctx: Ctx,
  type: "SUPPORT" | "REFUND_REQUEST" = "SUPPORT"
): Promise<void> {
  await ctx.reply(texts.supportPrompt, {
    parse_mode: "HTML",
    reply_markup: cancelKeyboard,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await conversation.wait();
    const text = next.message?.text?.trim();

    if (!text) continue;
    if (text === BTN.cancel || text === "/cancel") {
      await ctx.reply("Отменено.", { reply_markup: mainKeyboard });
      return;
    }
    if (text.length > TICKET_LIMITS.supportText) {
      await ctx.reply(
        `Сообщение слишком длинное (максимум ${TICKET_LIMITS.supportText} символов).`
      );
      continue;
    }
    if (text.length < 3) {
      await ctx.reply("Сообщение слишком короткое. Опиши проблему подробнее.");
      continue;
    }

    try {
      const res = await callApi<{ id: string }>(ctx, "/me/tickets", {
        method: "POST",
        body: { type, text },
      });
      await ctx.reply(
        [
          "🎫 <b>Тикет создан</b>",
          `Номер: <code>${res.id.slice(-6).toUpperCase()}</code>`,
          "",
          "Модератор ответит в этом чате. Обычно — в течение дня.",
        ].join("\n"),
        { parse_mode: "HTML", reply_markup: mainKeyboard }
      );
    } catch (err) {
      await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
    }
    return;
  }

  await ctx.reply("Попробуй ещё раз: /support", { reply_markup: mainKeyboard });
}
