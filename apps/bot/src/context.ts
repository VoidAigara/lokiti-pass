import type { Context } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

/**
 * Единый тип контекста бота: базовый Context + ctx.conversation.
 * Объявлен один раз и используется во всех хендлерах и меню —
 * иначе типы grammY и @grammyjs/conversations не сходятся.
 */
export type BotContext = Context & ConversationFlavor;
