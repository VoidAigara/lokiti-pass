import {
  MC_NICK_REGEX,
  RESERVED_NICKS,
} from "./constants.js";

export type NickValidation =
  | { ok: true; nick: string; nickLower: string }
  | { ok: false; reason: string };

/**
 * Валидация Minecraft-ника.
 * 3–16 символов, A-Z a-z 0-9 _, без кириллицы и пробелов.
 */
export function validateMcNick(raw: string): NickValidation {
  const nick = (raw ?? "").trim();

  if (!nick) return { ok: false, reason: "Ник не может быть пустым." };
  if (nick.length < 3 || nick.length > 16) {
    return {
      ok: false,
      reason: "Ник должен быть от 3 до 16 символов.",
    };
  }
  if (!MC_NICK_REGEX.test(nick)) {
    return {
      ok: false,
      reason:
        "Допустимы только латинские буквы, цифры и символ «_» (3–16 символов). Кириллица и пробелы запрещены.",
    };
  }
  if (RESERVED_NICKS.has(nick.toLowerCase())) {
    return { ok: false, reason: "Этот ник зарезервирован сервером." };
  }

  return { ok: true, nick, nickLower: nick.toLowerCase() };
}

export function isValidMcNick(raw: string): boolean {
  return validateMcNick(raw).ok;
}
