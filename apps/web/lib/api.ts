"use client";

import type { ApiError, MeResponse, CreatePaymentResponse } from "@loki/shared";
import type { PublicSeasonResponse, PublicStatusResponse } from "./types";

// Относительный путь: браузер зовёт /api/* того же origin. Локально это
// Next rewrite (см. next.config.mjs), во внешнем доступе — public-proxy
// (scripts/public-proxy.mjs). Один и тот же код работает и там, и там.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

// Сессия живёт в httpOnly-cookie `loki_token` (её ставит API на /auth/webapp).
// Токен в localStorage не храним: XSS не сможет украсть сессию,
// а SameSite=lax не даёт сайту-аутсайдеру воспользоваться кукой.

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | (string | undefined)[] | undefined,
    message: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Игнорируется: авторизация — always-on cookie (kept for call-site compat). */
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // cookie-сессия (loki_token) должна уходить с запросом
      credentials: "include",
    });
  } catch {
    throw new ApiRequestError(
      0,
      "NETWORK",
      "Нет связи с сервером. Попробуй позже."
    );
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // тело не JSON — остаётся null
  }

  if (!res.ok) {
    const err = payload as Partial<ApiError> | null;
    throw new ApiRequestError(
      res.status,
      err?.error,
      err?.message || `Ошибка сервера (${res.status}).`
    );
  }

  return payload as T;
}

export async function loginWithTelegram(initData: string): Promise<void> {
  // API ответит Set-Cookie (loki_token, httpOnly) — браузер сохранит сам
  await api<{ token: string }>("/auth/webapp", {
    method: "POST",
    auth: false,
    body: { initData },
  });
}

export async function logout(): Promise<void> {
  // сервер отзовёт сессию и пришлёт clearCookie
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return api<MeResponse>("/me", { signal });
}

export async function getSeason(signal?: AbortSignal) {
  return api<PublicSeasonResponse>("/public/season", { auth: false, signal });
}

export async function getStatus(signal?: AbortSignal) {
  return api<PublicStatusResponse>("/public/status", { auth: false, signal });
}

export async function createPayment(body: {
  type?: "NEW" | "RENEW";
  mcNick?: string;
}): Promise<CreatePaymentResponse> {
  return api<CreatePaymentResponse>("/payments/create", {
    method: "POST",
    body,
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Что-то пошло не так.";
}
