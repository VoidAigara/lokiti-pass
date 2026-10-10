"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/AuthProvider";
import { api, createPayment, errorMessage, getStatus, getSeason } from "@/lib/api";
import { formatKopecks, normalizeNick } from "@/lib/utils";
import { haptic, notify, deepLink, inTelegram, openBot } from "@/lib/telegram";
import type { PublicSeasonResponse, PublicStatusResponse } from "@/lib/types";
import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
  MC_NICK_REGEX,
} from "@loki/shared";

const NICK_RE = MC_NICK_REGEX;

type Tab = "NEW" | "RENEW";

export function BuyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, me, refresh, login } = useAuth();

  const [tab, setTab] = useState<Tab>("NEW");
  const [nick, setNick] = useState("");
  const [nickError, setNickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<PublicSeasonResponse | null>(null);
  const [server, setServer] = useState<PublicStatusResponse | null>(null);

  useEffect(() => {
    if (params.get("tab") === "renew") setTab("RENEW");
  }, [params]);

  useEffect(() => {
    getSeason().then(setSeason).catch(() => undefined);
    getStatus().then(setServer).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (me?.player?.mcNick) setNick(me.player.mcNick);
    if (me?.offer?.kind === "RENEW") setTab("RENEW");
    if (me?.offer?.kind === "NEW") setTab("NEW");
  }, [me?.player?.mcNick, me?.offer?.kind]);

  const prices = season?.prices ?? {
    new: DEFAULT_PRICE_NEW_KOPECKS,
    renew: DEFAULT_PRICE_RENEW_KOPECKS,
  };
  const amount = tab === "NEW" ? prices.new : prices.renew;

  const authed = status === "ready" && Boolean(me);
  const lockedReason = me?.offer?.kind ?? null;

  const validateNick = useCallback((value: string): string | null => {
    if (!value) return "Введи Minecraft-ник.";
    if (!NICK_RE.test(value)) return "Ник: 3–16 символов, латиница, цифры и _.";
    return null;
  }, []);

  const pay = async (provider: "yookassa" | "stars") => {
    setError(null);
    haptic("medium");
    setBusy(true);
    try {
      if (!authed) {
        if (!inTelegram()) {
          openBot();
          setError(
            "Вход и оплата работают внутри Telegram — открываю бота. Напиши /start и вернись на сайт по кнопке в боте."
          );
          return;
        }
        const ok = await login();
        if (!ok) {
          setError("Не получилось войти. Попробуй ещё раз или напиши в поддержку.");
          return;
        }
      }

      if (tab === "NEW" && !me?.player?.mcNick) {
        const err = validateNick(nick);
        setNickError(err);
        if (err) return;
        await api("/me/nick", { method: "POST", body: { mcNick: nick } });
        await refresh();
      }

      const res = await createPayment({
        type: tab,
        mcNick: me?.player?.mcNick ? undefined : nick,
      });

      notify("success");

      if (provider === "stars") {
        router.push("/profile?tab=stars");
        return;
      }

      if (res.confirmationUrl) {
        if (typeof window !== "undefined" && window.Telegram?.WebApp) {
          window.Telegram.WebApp.openLink(res.confirmationUrl);
        } else {
          window.open(res.confirmationUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        setError("Не удалось создать платёж. Попробуй позже.");
      }
    } catch (err) {
      notify("error");
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const locked = useMemo(() => {
    if (lockedReason === "ALREADY_ACTIVE")
      return "Проходка уже активна — доступ действует до конца сезона.";
    if (lockedReason === "NO_SEASON")
      return "Сезон пока не открыт. Объявим вайп в боте — тогда продление станет доступно.";
    return null;
  }, [lockedReason]);

  return (
    <div className="container py-12 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mx-auto max-w-5xl"
      >
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="chip">Оплата</span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Купить проходку
            </h1>
          </div>
          {season?.season && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-faint">
                Текущий сезон
              </div>
              <div className="font-display text-lg font-semibold text-ink">
                {season.season.number}. {season.season.name}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="p-2 sm:p-2">
            <div className="grid grid-cols-2 gap-1.5 p-2">
              {(
                [
                  { key: "NEW", label: "Новый игрок", price: prices.new },
                  { key: "RENEW", label: "Продление", price: prices.renew },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition ${
                    tab === t.key
                      ? "border-line bg-soft"
                      : "border-transparent hover:bg-soft/60"
                  }`}
                >
                  <div
                    className={`font-display text-sm font-semibold ${
                      tab === t.key ? "text-ink" : "text-faint"
                    }`}
                  >
                    {t.label}
                  </div>
                  <div
                    className={`mt-1 text-lg font-bold ${
                      tab === t.key ? "text-ink" : "text-faint"
                    }`}
                  >
                    {formatKopecks(t.price)}
                  </div>
                </button>
              ))}
            </div>

            <CardHeader className="px-4 sm:px-6">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-magic-dark" />
                Твой Minecraft-ник
              </CardTitle>
              <CardDescription>
                {me?.player?.mcNick
                  ? "Ник уже привязан — менять его можно заявкой в боте."
                  : "Один Telegram-аккаунт — один ник. Формат: 3–16 символов, латиница, цифры и _."}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-4 sm:px-6">
              <div className="relative">
                <Input
                  value={me?.player?.mcNick ?? nick}
                  onChange={(e) => {
                    setNick(normalizeNick(e.target.value));
                    setNickError(null);
                  }}
                  disabled={Boolean(me?.player?.mcNick)}
                  placeholder="Steve_2024"
                  className="h-12 pr-11 font-mono"
                  maxLength={16}
                  autoComplete="off"
                  spellCheck={false}
                />
                {me?.player?.mcNick && (
                  <CheckCircle2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-700" />
                )}
              </div>
              {nickError && (
                <p className="mt-2 text-xs text-red-600">{nickError}</p>
              )}

              <div className="hairline my-6" />

              <div className="space-y-3 text-sm">
                <Row label="Тип" value={tab === "NEW" ? "Новая проходка" : "Продление"} />
                <Row label="Сезон" value={season?.season ? `${season.season.number}. ${season.season.name}` : "—"} />
                <Row label="Доступен до" value={season?.season?.endedAt ? new Date(season.season.endedAt).toLocaleDateString("ru-RU") : "до вайпа"} />
                <Row label="Сумма" value={formatKopecks(amount)} strong />
              </div>

              {error && (
                <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              {locked ? (
                <div className="mt-6 space-y-3">
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                    <Lock className="mr-2 inline h-4 w-4" />
                    {locked}
                  </div>
                  <Button variant="glass" className="w-full" onClick={() => router.push("/profile")}>
                    Перейти в профиль
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void pay("yookassa")}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    Оплатить {formatKopecks(amount)} картой / СБП
                  </Button>

                  <Button
                    variant="glass"
                    size="lg"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void pay("stars")}
                  >
                    <Sparkles className="h-4 w-4 text-faint" />
                    Оплатить Telegram Stars
                  </Button>

                  <p className="text-center text-xs text-zinc-500">
                    Нажимая кнопку, ты соглашаешься с{" "}
                    <a href="/refund" className="text-magic-dark underline-offset-2 hover:underline">
                      условиями возврата
                    </a>
                    .
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <CardTitle className="flex items-center gap-2">
                <Badge variant="success">онлайн</Badge>
                Статус сервера
              </CardTitle>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Stat
                  label="Игроков сейчас"
                  value={server?.ok ? String(server.online ?? 0) : "—"}
                />
                <Stat label="Слоты" value={server?.max ? `/${server.max}` : "—"} />
                <Stat label="IP" value={server?.serverIp ?? "—"} mono />
                <Stat
                  label="Версия"
                  value={server?.version ?? (server?.ok ? "Java" : "—")}
                />
              </div>
            </Card>

            <Card className="p-6">
              <CardTitle>Что входит</CardTitle>
              <ul className="mt-5 space-y-3">
                {[
                  "Доступ на whitelist до конца сезона",
                  "Автоматическая выдача после оплаты",
                  "История платежей в кабинете",
                  "Поддержка и возвраты по правилам",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-sm text-zinc-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>

            {!authed && status !== "loading" && (
              <Card className="p-6">
                <CardTitle className="text-base">Вход</CardTitle>
                <CardDescription className="mt-2">
                  Оплата привязывается к Telegram-аккаунту: вход и оплата идут
                  через бота. Нажми «Оплатить» — откроется бот.
                </CardDescription>
                <div className="mt-4">
                  <a href={deepLink("/start")} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="w-full">
                      Открыть бота
                    </Button>
                  </a>
                </div>
              </Card>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-faint">{label}</span>
      <span className={strong ? "font-display text-base font-bold text-ink" : "text-body"}>
        {value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-soft p-4">
      <div className="text-[11px] uppercase tracking-widest text-faint">{label}</div>
      <div
        className={`mt-1.5 truncate font-display text-base font-bold text-ink ${
          mono ? "font-mono text-sm" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
