/** Цены по умолчанию (копейки). Переопределяются в Season. */
export const DEFAULT_PRICE_NEW_KOPECKS = 50_000; // 500 ₽
export const DEFAULT_PRICE_RENEW_KOPECKS = 20_000; // 200 ₽

/** Валидация Minecraft-ника: 3–16 символов, латиница/цифры/подчёркивание. */
export const MC_NICK_REGEX = /^[A-Za-z0-9_]{3,16}$/;

/** Резервированные ники — нельзя занимать. */
export const RESERVED_NICKS = new Set(
  [
    "admin",
    "administrator",
    "operator",
    "op",
    "moderator",
    "mod",
    "helper",
    "system",
    "server",
    "console",
    "rcon",
    "loki",
    "lokiti",
    "everyone",
    "all",
    "null",
    "undefined",
  ].map((n) => n.toLowerCase())
);

export const TICKET_LIMITS = {
  supportText: 1000,
  nickChangeReason: 300,
} as const;

export const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 10);

/** Команды бота для @BotFather. */
export const BOT_COMMANDS = [
  { command: "start", description: "Главное меню" },
  { command: "buy", description: "Купить проходку" },
  { command: "renew", description: "Продлить после вайпа" },
  { command: "me", description: "Мой профиль" },
  { command: "nick", description: "Привязать / сменить ник" },
  { command: "support", description: "Написать в поддержку" },
  { command: "admin", description: "Панель администратора" },
  { command: "help", description: "Справка" },
] as const;

export type BotCommand = (typeof BOT_COMMANDS)[number]["command"];

/** Действия, которые пишутся в AuditLog. */
export const AUDIT_ACTIONS = {
  SEASON_CREATE: "SEASON_CREATE",
  SEASON_CLOSE: "SEASON_CLOSE",
  SEASON_WIPE: "SEASON_WIPE",
  PRICE_CHANGE: "PRICE_CHANGE",
  PAYMENT_REFUND: "PAYMENT_REFUND",
  PAYMENT_MANUAL: "PAYMENT_MANUAL",
  PLAYER_BAN: "PLAYER_BAN",
  PLAYER_UNBAN: "PLAYER_UNBAN",
  PLAYER_NICK_CHANGE: "PLAYER_NICK_CHANGE",
  WHITELIST_ADD: "WHITELIST_ADD",
  WHITELIST_REMOVE: "WHITELIST_REMOVE",
  TICKET_RESOLVE: "TICKET_RESOLVE",
  BROADCAST_SEND: "BROADCAST_SEND",
  ADMIN_LOGIN: "ADMIN_LOGIN",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
