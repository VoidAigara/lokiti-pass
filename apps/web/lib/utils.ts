import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatKopecks(kopecks: number): string {
  const rub = Math.round(kopecks / 100);
  return `${rub.toLocaleString("ru-RU")} ₽`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt).getTime();
  if (Number.isNaN(exp)) return null;
  return Math.ceil((exp - Date.now()) / 86_400_000);
}

export function normalizeNick(raw: string): string {
  return raw.replace(/[^\w]/g, "");
}
