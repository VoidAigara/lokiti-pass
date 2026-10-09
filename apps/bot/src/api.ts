import { botEnv } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface SessionUser {
  id: string;
  tgId: string;
  tgUsername: string | null;
  firstName: string | null;
  isAdmin: boolean;
}

const tokenCache = new Map<string, string>();

async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await fetch(`${botEnv.API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(botEnv.INTERNAL_TOKEN
          ? { "x-internal-token": botEnv.INTERNAL_TOKEN }
          : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const e = data as { error?: string; message?: string } | null;
      throw new ApiError(
        res.status,
        e?.error ?? "INTERNAL",
        e?.message ?? `API вернул ${res.status}`
      );
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface TgProfile {
  tgId: number;
  firstName?: string | null;
  username?: string | null;
}

/** Получает (и кэширует) JWT для пользователя от имени бота. */
export async function getToken(profile: TgProfile): Promise<string> {
  const key = String(profile.tgId);
  const cached = tokenCache.get(key);
  if (cached) return cached;

  const res = await request<{ token: string; user: SessionUser }>(
    "/auth/bot-session",
    {
      method: "POST",
      body: {
        tgId: key,
        firstName: profile.firstName ?? null,
        tgUsername: profile.username ?? null,
      },
    }
  );
  tokenCache.set(key, res.token);
  return res.token;
}

export function dropToken(tgId: number | string): void {
  tokenCache.delete(String(tgId));
}

export const api = {
  get: <T>(token: string, path: string) => request<T>(token ? path : path, { token }),
  post: <T>(token: string, path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body, token }),
  patch: <T>(token: string, path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body, token }),
  /** вызовы без JWT (public, health) */
  anon: <T>(path: string) => request<T>(path),
};

export type { SessionUser };
