"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MeResponse } from "@loki/shared";
import {
  ApiRequestError,
  api,
  errorMessage,
  getMe,
  loginWithTelegram,
} from "@/lib/api";
import { getTelegramWebApp, initTelegramWebApp } from "@/lib/telegram";

type Status = "idle" | "loading" | "ready" | "anon" | "error";

interface AuthState {
  status: Status;
  me: MeResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
  login: () => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  status: "idle",
  me: null,
  error: null,
  refresh: async () => undefined,
  login: async () => false,
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // сессия — cookie: даже без предварительного токена пробуем /me;
    // 401 (нет куки/истекла) ⇒ аноним, остальное ⇒ ошибка
    try {
      const data = await getMe();
      setMe(data);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setMe(null);
        setStatus("anon");
      } else {
        setError(errorMessage(err));
        setStatus("error");
      }
    }
  }, []);

  const login = useCallback(async () => {
    const tg = getTelegramWebApp();
    if (!tg?.initData) {
      setStatus("anon");
      return false;
    }
    setStatus("loading");
    try {
      await loginWithTelegram(tg.initData);
      const data = await getMe();
      setMe(data);
      setError(null);
      setStatus("ready");
      return true;
    } catch (err) {
      setError(errorMessage(err));
      setStatus("error");
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe(null);
    setStatus("anon");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      initTelegramWebApp();
      if (cancelled) return;
      const tg = getTelegramWebApp();
      if (tg?.initData) {
        await login();
      } else {
        await refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [login, refresh]);

  const value = useMemo<AuthState>(
    () => ({ status, me, error, refresh, login, logout }),
    [status, me, error, refresh, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
