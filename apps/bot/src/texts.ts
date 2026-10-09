import {
  COPY,
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
  formatKopecks,
  type Offer,
} from "@loki/shared";
import { botEnv } from "./config.js";

export const BTN = {
  buy: "🎟 Купить проходку",
  renew: "♻️ Продлить",
  profile: "👤 Кабинет",
  support: "🆘 Поддержка",
  back: "↩️ Назад",
  cancel: "✖️ Отмена",
} as const;

/**
 * Кнопки главного меню — обычные текстовые: нажатие отправляет текст в чат,
 * где его подхватывает bot.hears() и открывает сцену в чате.
 * Если задан https WEB_URL — добавляется web_app-кнопка: сайт открывается
 * как Telegram Mini App внутри клиента (initData → автологин на сайте).
 */
const webAppUrl = botEnv.WEB_URL.startsWith("https://") ? botEnv.WEB_URL : null;

export const mainKeyboard = {
  keyboard: [
    [{ text: BTN.buy }, { text: BTN.renew }],
    [{ text: BTN.profile }, { text: BTN.support }],
    ...(webAppUrl
      ? ([[ { text: "🌐 Кабинет на сайте", web_app: { url: webAppUrl } } ]] as [
          [{ text: string; web_app: { url: string } }]
        ])
      : []),
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const cancelKeyboard = {
  keyboard: [[{ text: BTN.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const texts = {
  start(name?: string | null): string {
    const greet = name ? `Привет, <b>${escapeHtml(name)}</b>!` : "Привет!";
    return [
      `👋 ${greet}`,
      "",
      `Это бот проходки на приватный Minecraft-сервер <b>${COPY.streamerName}</b> (сквад ${COPY.squad}).`,
      "",
      `🎮 Сейчас онлайн: смотри на сайте`,
      `🧾 Первый вход — <b>${formatKopecks(DEFAULT_PRICE_NEW_KOPECKS)}</b>, продление после вайпа — <b>${formatKopecks(DEFAULT_PRICE_RENEW_KOPECKS)}</b>`,
      "",
      "Выбери действие ниже 👇",
    ].join("\n");
  },

  help: [
    "📖 <b>Справка</b>",
    "",
    "/start — главное меню",
    "/buy — купить проходку (500 ₽)",
    "/renew — продление после вайпа (200 ₽)",
    "/me — профиль, статус и история",
    "/nick — привязать или сменить ник",
    "/support — тикет в поддержку",
    "/help — эта справка",
    "",
    "Админам: /admin — панель управления.",
  ].join("\n"),

  nickPrompt:
    "🏷 <b>Введи свой Minecraft-ник</b>\n\n" +
    "Правила: 3–16 символов, только латиница, цифры и «_».\n" +
    "Например: <code>Loki_Player</code>",

  nickInvalid(reason: string): string {
    return `❌ <b>Ник не подходит</b>\n\n${escapeHtml(reason)}`;
  },

  nickBound(nick: string): string {
    return `✅ Ник <code>${escapeHtml(nick)}</code> привязан к твоему аккаунту.`;
  },

  nickChangeTicket(nick: string): string {
    return [
      `📝 Заявка на смену ника отправлена: <code>${escapeHtml(nick)}</code>`,
      "",
      "Модератор проверит её в ближайшее время, я пришлю уведомление.",
    ].join("\n");
  },

  offer(o: Offer, opts: { hasNick: boolean; nick?: string }): string {
    const season = o.season;
    const lines: string[] = [];

    if (o.kind === "NO_SEASON") {
      return `⏳ ${escapeHtml(o.reason ?? "Сезон пока не объявлен.")}`;
    }
    if (o.kind === "ALREADY_ACTIVE") {
      return [
        "✅ <b>У тебя уже есть доступ</b>",
        escapeHtml(o.reason ?? ""),
        "",
        `Сезон: <b>${escapeHtml(season?.name ?? "")}</b>`,
        `IP: <code>${escapeHtml(botEnv.MC_SERVER_IP)}</code>`,
      ].join("\n");
    }

    lines.push(
      o.type === "RENEW"
        ? "♻️ <b>Продление после вайпа</b>"
        : "🎟 <b>Новая проходка</b>"
    );
    lines.push("");
    if (season) {
      lines.push(`Сезон: <b>#${season.number} — ${escapeHtml(season.name)}</b>`);
    }
    lines.push(`Цена: <b>${formatKopecks(o.amount)}</b>`);
    lines.push("");
    lines.push("Что входит:");
    for (const w of COPY.whatIsIncluded.slice(0, 3)) {
      lines.push(`  • ${escapeHtml(w)}`);
    }
    lines.push("");
    if (opts.hasNick && opts.nick) {
      lines.push(`Ник: <code>${escapeHtml(opts.nick)}</code>`);
    } else {
      lines.push("⚠️ Сначала введём ник.");
    }
    lines.push("");
    lines.push("Оплата: ЮMoney (карта/СБП) или Telegram Stars.");
    return lines.join("\n");
  },

  payButton(amount: number, type: "NEW" | "RENEW"): string {
    return type === "RENEW"
      ? `Продлить за ${formatKopecks(amount)}`
      : `Оплатить ${formatKopecks(amount)}`;
  },

  profile(input: {
    nick: string | null;
    status: string;
    seasonName: string | null;
    seasonNumber: number | null;
    totalPaid: number;
    renewalCount: number;
    lastPaidAt: string | null;
    offer: Offer;
  }): string {
    const statusLabel: Record<string, string> = {
      ACTIVE: "🟢 Доступ активен",
      EXPIRED: "🟠 Нужно продление",
      PENDING: "🟡 Оплачено, ждём выдачу",
      BANNED: "🔴 Ник заблокирован",
    };
    return [
      "👤 <b>Твой профиль</b>",
      "",
      `Ник: <code>${escapeHtml(input.nick ?? "— не привязан —")}</code>`,
      `Статус: ${statusLabel[input.status] ?? escapeHtml(input.status)}`,
      input.seasonName
        ? `Сезон: <b>#${input.seasonNumber} — ${escapeHtml(input.seasonName)}</b>`
        : "Сезон: —",
      "",
      `Всего оплачено: <b>${formatKopecks(input.totalPaid)}</b>`,
      `Продлений: <b>${input.renewalCount}</b>`,
      input.lastPaidAt
        ? `Последняя оплата: ${formatDate(input.lastPaidAt)}`
        : "",
      "",
      input.offer.kind === "ALREADY_ACTIVE"
        ? `🎮 Заходи: <code>${escapeHtml(botEnv.MC_SERVER_IP)}</code>`
        : input.offer.kind === "RENEW"
          ? `♻️ Продление доступно за <b>${formatKopecks(input.offer.amount)}</b>`
          : input.offer.kind === "NEW"
            ? `🎟 Проходка стоит <b>${formatKopecks(input.offer.amount)}</b>`
            : escapeHtml(input.offer.reason ?? ""),
    ]
      .filter(Boolean)
      .join("\n");
  },

  noNick: "⚠️ Сначала привяжи ник командой <b>/nick</b>.",

  alreadyPaid: "⏳ По этому платежу оплата уже получена.",

  supportPrompt:
    "🆘 <b>Напиши сообщение в поддержку</b>\n\n" +
    "Опиши проблему в одном сообщении (до 1000 символов).",
} satisfies Record<string, string | ((...args: never[]) => string)>;

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
