"use client";

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: { user?: WebAppUser; auth_date?: number };
        ready(): void;
        expand(): void;
        setHeaderColor(color: string): void;
        setBackgroundColor(color: string): void;
        openLink(url: string): void;
        close(): void;
        HapticFeedback?: {
          impactOccurred(style: "light" | "medium" | "heavy"): void;
          notificationOccurred(type: "success" | "error" | "warning"): void;
          selectionChanged(): void;
        };
      };
    };
  }
}

export function getTelegramWebApp() {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

export function isTelegramWebApp(): boolean {
  return Boolean(getTelegramWebApp());
}

export function initTelegramWebApp(): WebAppUser | null {
  const tg = getTelegramWebApp();
  if (!tg) return null;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#0B0A1F");
    tg.setBackgroundColor("#07061A");
  } catch {
    /* ignore */
  }
  return tg.initDataUnsafe?.user ?? null;
}

export function haptic(style: "light" | "medium" | "heavy" = "light") {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
}

export function notify(
  type: "success" | "error" | "warning" = "success"
) {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
}

export function deepLink(path: string): string {
  const bot = process.env.NEXT_PUBLIC_BOT_USERNAME || "lokitiserver_bot";
  return `https://t.me/${bot}${path}`;
}

/** True only inside Telegram's in-app browser with valid initData. */
export function inTelegram(): boolean {
  return Boolean(getTelegramWebApp()?.initData);
}

/** Send the user to the bot (auto-called on login attempts outside Telegram). */
export function openBot(path = "/start") {
  const url = deepLink(path);
  try {
    const tg = getTelegramWebApp();
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
  } catch {
    /* fall through */
  }
  // A real <a> click: unlike window.open() it is never blocked by pop-up blockers.
  // Remove it only after the browser has had a chance to handle the click.
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 10_000);
}
