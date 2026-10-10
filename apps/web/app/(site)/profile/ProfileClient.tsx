"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Clock,
  History,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import { MC_NICK_REGEX, type MeResponse, type TicketDto } from "@loki/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/AuthProvider";
import { api, errorMessage } from "@/lib/api";
import { daysLeft, formatDate, formatKopecks } from "@/lib/utils";
import { deepLink, notify } from "@/lib/telegram";

const NICK_RE = MC_NICK_REGEX;

export function ProfileClient() {
  const { status, me, logout, refresh, error } = useAuth();

  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [newNick, setNewNick] = useState("");
  const [ticketText, setTicketText] = useState("");
  const [ticketType, setTicketType] = useState<"SUPPORT" | "REFUND_REQUEST">(
    "SUPPORT"
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      const res = await api<{ tickets: TicketDto[] }>("/me/tickets");
      setTickets(res.tickets);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (status === "ready") void loadTickets();
  }, [status, loadTickets]);

  const send = async (
    path: string,
    body: unknown,
    successMsg: string
  ): Promise<boolean> => {
    setBusy(true);
    setFormError(null);
    setOk(null);
    try {
      await api(path, { method: "POST", body });
      setOk(successMsg);
      notify("success");
      return true;
    } catch (err) {
      setFormError(errorMessage(err));
      notify("error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitNickRequest = async () => {
    if (!NICK_RE.test(newNick)) {
      setFormError("Ник: 3–16 символов, латиница, цифры и _.");
      return;
    }
    const done = await send(
      "/me/nick-request",
      { newNick },
      "Заявка отправлена — модератор рассмотрит её."
    );
    if (done) setNewNick("");
    void loadTickets();
  };

  const submitTicket = async () => {
    if (ticketText.trim().length < 3) {
      setFormError("Опиши вопрос подробнее (минимум 3 символа).");
      return;
    }
    const done = await send(
      "/me/tickets",
      { type: ticketType, text: ticketText.trim() },
      "Обращение создано. Ответ придёт в Telegram."
    );
    if (done) setTicketText("");
    void loadTickets();
  };

  if (status === "idle" || status === "loading") {
    return (
      <div className="container space-y-5 py-16">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (status === "anon" || status === "error") {
    return (
      <div className="container flex min-h-[60vh] flex-col items-center justify-center py-16">
        <span className="chip">Личный кабинет</span>
        <h1 className="mt-5 text-center font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Кабинет игрока
        </h1>

        <Card className="relative mt-8 max-w-md p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-magic/25 to-magic/10">
            <UserRound className="h-6 w-6 text-magic" />
          </div>
          <CardTitle className="mt-5">Вход в кабинет</CardTitle>
          <CardDescription className="mt-2">
            {error ??
              "Кабинет открывается внутри Telegram: нажми «Кабинет» в меню бота — вход произойдёт автоматически."}
          </CardDescription>
          <div className="mt-6 flex flex-col gap-2">
            <a href={deepLink("/start")} target="_blank" rel="noreferrer">
              <Button className="w-full">Открыть бота</Button>
            </a>
          </div>
        </Card>
      </div>
    );
  }

  return <Profile me={me!} tickets={tickets} busy={busy} ok={ok} formError={formError}
    newNick={newNick} setNewNick={setNewNick} ticketText={ticketText}
    setTicketText={setTicketText} ticketType={ticketType} setTicketType={setTicketType}
    submitNickRequest={submitNickRequest} submitTicket={submitTicket}
    onRefresh={() => void refresh()} onLogout={() => void logout()} />;
}

function Profile({
  me,
  tickets,
  busy,
  ok,
  formError,
  newNick,
  setNewNick,
  ticketText,
  setTicketText,
  ticketType,
  setTicketType,
  submitNickRequest,
  submitTicket,
  onRefresh,
  onLogout,
}: {
  me: MeResponse;
  tickets: TicketDto[];
  busy: boolean;
  ok: string | null;
  formError: string | null;
  newNick: string;
  setNewNick: (v: string) => void;
  ticketText: string;
  setTicketText: (v: string) => void;
  ticketType: "SUPPORT" | "REFUND_REQUEST";
  setTicketType: (v: "SUPPORT" | "REFUND_REQUEST") => void;
  submitNickRequest: () => void;
  submitTicket: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const player = me.player;
  const offer = me.offer;
  const isActive = player?.status === "ACTIVE";
  const left = daysLeft(player?.currentSeason?.endedAt);

  const pendingTicket = useMemo(
    () => tickets.find((t) => t.status === "OPEN"),
    [tickets]
  );

  return (
    <div className="container py-12 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="space-y-6"
      >
        <Card className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-magic to-magic-light font-display text-lg font-black text-[#0A0A0C]">
                {(me.user.firstName ?? "L").slice(0, 1).toUpperCase()}
              </div>
              <div>
                <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
                  {me.user.firstName ?? "Игрок"}
                  {me.user.tgUsername && (
                    <span className="ml-2 text-sm font-normal text-faint">
                      @{me.user.tgUsername}
                    </span>
                  )}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {isActive ? (
                    <Badge variant="success">
                      <BadgeCheck className="h-3 w-3" /> проходка активна
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <ShieldAlert className="h-3 w-3" />{" "}
                      {player?.status ?? "нет доступа"}
                    </Badge>
                  )}
                  {player?.mcNick && <Badge variant="muted">{player.mcNick}</Badge>}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" /> Обновить
              </Button>
              <Button variant="glass" size="sm" onClick={onLogout}>
                <LogOut className="h-4 w-4" /> Выйти
              </Button>
            </div>
          </div>

          <div className="hairline my-6" />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info
              icon={<UserRound className="h-4 w-4" />}
              label="Minecraft-ник"
              value={player?.mcNick ?? "не привязан"}
            />
            <Info
              icon={<Clock className="h-4 w-4" />}
              label="Сезон"
              value={
                player?.currentSeason
                  ? `${player.currentSeason.number}. ${player.currentSeason.name}`
                  : "—"
              }
            />
            <Info
              icon={<BadgeCheck className="h-4 w-4" />}
              label="Доступ до"
              value={
                player?.currentSeason?.endedAt
                  ? formatDate(player.currentSeason.endedAt)
                  : "до вайпа"
              }
              sub={left !== null ? `осталось ${left} дн.` : undefined}
            />
            <Info
              icon={<History className="h-4 w-4" />}
              label="Всего оплачено"
              value={formatKopecks(player?.totalPaid ?? 0)}
              sub={
                player?.renewalCount
                  ? `продлений: ${player.renewalCount}`
                  : undefined
              }
            />
          </div>

          {offer.kind !== "ALREADY_ACTIVE" && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-magic/25 bg-magic/10 p-4">
              <div className="text-sm text-zinc-300">
                {offer.kind === "RENEW"
                  ? "Продли проходку после вайпа и вернись на сервер."
                  : offer.kind === "NO_SEASON"
                    ? "Сезон не открыт — напишем в боте, когда начнётся новый."
                    : "Оплати проходку, чтобы получить доступ на whitelist."}
              </div>
              <a href="/buy">
                <Button size="sm">
                  <Sparkles className="h-4 w-4" />
                  {formatKopecks(offer.amount)}
                </Button>
              </a>
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4 text-magic-dark" />
                История платежей
              </CardTitle>
              <CardDescription>
                Последние операции по твоему аккаунту.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {me.payments.length === 0 ? (
                <p className="text-sm text-zinc-500">Платежей пока нет.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {me.payments.slice(0, 8).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <div className="text-sm font-medium text-zinc-200">
                          {formatKopecks(p.amount)}{" "}
                          <span className="text-zinc-500">· {p.type}</span>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatDate(p.createdAt)} ·{" "}
                          {p.provider === "YOOKASSA"
                            ? "карта/СБП"
                            : p.provider === "STARS"
                              ? "Telegram Stars"
                              : "вручную"}
                        </div>
                      </div>
                      <Badge
                        variant={
                          p.status === "PAID"
                            ? "success"
                            : p.status === "PENDING"
                              ? "warning"
                              : p.status === "REFUNDED"
                                ? "muted"
                                : "danger"
                        }
                      >
                        {p.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-4 w-4 text-magic-dark" />
                Обращение
              </CardTitle>
              <CardDescription>
                Смена ника, вопрос по оплате или возврат — всё через один тикет.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {player?.mcNick && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
                    Новый ник
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={newNick}
                      onChange={(e) => setNewNick(e.target.value.replace(/[^\w]/g, ""))}
                      placeholder="Новый_ник"
                      maxLength={16}
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      onClick={submitNickRequest}
                      disabled={busy || !newNick}
                    >
                      Сменить
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
                  Тип обращения
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={ticketType === "SUPPORT" ? "outline" : "glass"}
                    size="sm"
                    onClick={() => setTicketType("SUPPORT")}
                  >
                    Вопрос в поддержку
                  </Button>
                  <Button
                    variant={ticketType === "REFUND_REQUEST" ? "outline" : "glass"}
                    size="sm"
                    onClick={() => setTicketType("REFUND_REQUEST")}
                  >
                    Запрос возврата
                  </Button>
                </div>
              </div>

              <Textarea
                value={ticketText}
                onChange={(e) => setTicketText(e.target.value)}
                placeholder={
                  ticketType === "SUPPORT"
                    ? "Опиши вопрос: что случилось, какой платёж или ник…"
                    : "Укажи платёж и причину возврата…"
                }
                maxLength={2000}
              />

              {formError && (
                <p className="text-xs text-red-600">{formError}</p>
              )}
              {ok && <p className="text-xs text-emerald-700">{ok}</p>}

              <Button
                className="w-full"
                onClick={submitTicket}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {pendingTicket ? "Добавить к открытому тикету" : "Отправить"}
              </Button>

              {tickets.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-xs uppercase tracking-widest text-zinc-500">
                    Мои обращения
                  </div>
                  {tickets.slice(0, 5).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-xl border border-black/8 bg-white/[0.03] px-3 py-2 text-xs"
                    >
                      <span className="text-zinc-300">{t.type}</span>
                      <span className="text-zinc-500">
                        {t.status} · {formatDate(t.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}

function Info({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-zinc-500">
        <span className="text-magic-dark">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate font-display text-sm font-semibold text-ink">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
