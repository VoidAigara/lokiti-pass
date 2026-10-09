export const BOT_USERNAME =
  process.env.NEXT_PUBLIC_BOT_USERNAME || "lokitiserver_bot";

export function deepLink(path: string): string {
  return `https://t.me/${BOT_USERNAME}${path}`;
}

export function botUrl(): string {
  return `https://t.me/${BOT_USERNAME}`;
}
