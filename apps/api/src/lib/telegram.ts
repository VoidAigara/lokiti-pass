import { env } from "../config.js";
import { logger } from "./logger.js";

interface TgResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callApi<T>(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<T> {
  const url = `${env.TELEGRAM_API_URL}/bot${env.BOT_TOKEN}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await res.json()) as TgResponse<T>;
    if (!data.ok) {
      throw new Error(
        `Telegram ${method} failed: ${data.error_code} ${data.description}`
      );
    }
    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  opts: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: unknown;
    disableNotification?: boolean;
    linkPreview?: boolean;
  } = {}
): Promise<boolean> {
  try {
    await callApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode ?? "HTML",
      disable_notification: opts.disableNotification ?? false,
      link_preview_options: { is_disabled: opts.linkPreview === false },
      ...(opts.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
    });
    return true;
  } catch (err) {
    logger.warn({ err, chatId }, "sendMessage failed");
    return false;
  }
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  try {
    await callApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  } catch (err) {
    logger.debug({ err }, "answerCallbackQuery failed");
  }
}

/**
 * Возврат платежа Telegram Stars. Возвращает деньги игроку с его баланса
 * Stars / карты, привязанной к Telegram. Делается только этим ботом —
 * тем, что получил оплату.
 */
export async function refundStarPayment(
  userId: number,
  telegramPaymentChargeId: string
): Promise<void> {
  await callApi("refundStarPayment", {
    user_id: userId,
    telegram_payment_charge_id: telegramPaymentChargeId,
  });
}

export async function setMyCommands(
  commands: Array<{ command: string; description: string }>
): Promise<void> {
  try {
    await callApi("setMyCommands", { commands });
  } catch (err) {
    logger.warn({ err }, "setMyCommands failed");
  }
}

export async function getChatMemberCount(chatId: number | string): Promise<number | null> {
  try {
    return await callApi<number>("getChatMemberCount", { chat_id: chatId });
  } catch {
    return null;
  }
}

/** Отправка уведомления «доступ выдан» и т.п. с повторами. */
export async function notifyUser(
  tgId: number | bigint,
  text: string,
  replyMarkup?: unknown
): Promise<void> {
  const chatId = Number(tgId);
  const ok = await sendMessage(chatId, text, { replyMarkup });
  if (!ok) {
    // одна попытка через 2 сек — на случай флапа сети
    await new Promise((r) => setTimeout(r, 2000));
    await sendMessage(chatId, text, { replyMarkup });
  }
}
