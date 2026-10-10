"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Coins,
  FileClock,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  ServerCog,
  ShieldOff,
  Ticket as TicketIcon,
  UserRound,
} from "lucide-react";
import {
  DEFAULT_PRICE_NEW_KOPECKS,
  DEFAULT_PRICE_RENEW_KOPECKS,
  type PaymentDto,
  type SeasonDto,
} from "@loki/shared";
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
import { cn, formatDate, formatKopecks } from "@/lib/utils";
import { notify } from "@/lib/telegram";
import type {
  AdminStatsResponse,
  AdminTicketDetail,
  NickRequestDetail,
} from "@/lib/types";

type Tab = "overview" | "players" | "payments" | "tickets" | "seasons" | "logs";

const tabs: { key: Tab; label: string; icon: typeof Coins }[] = [
  { key: "overview", label: "Сводка", icon: Coins },
  { key: "players", label: "Игроки", icon: UserRound },
  { key: "payments", label: "Платежи", icon: FileClock },
  { key: "tickets", label: "Тикеты", icon: TicketIcon },
  { key: "seasons", label: "Сезон", icon: ServerCog },
  { key: "logs", label: "Логи", icon: AlertTriangle },
];

export function AdminClient() {
  const { status, me } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const isAdmin = Boolean(me?.user?.isAdmin);

  const toast = useCallback((kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    notify(kind === "ok" ? "success" : "error");
    setTimeout(() => setNotice(null), 6000);
  }, []);

  if (status === "idle" || status === "loading") {
    return (
      <div className="container space-y-5 py-16">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (status === "anon" || !isAdmin) {
    return (
      <div className="container py-24">
        <Card className="mx-auto max-w-md p-8 text-center">
          <CardTitle>Нет доступа</CardTitle>
          <CardDescription className="mt-2">
            Раздел доступен только администрации. Войди в Telegram-аккаунт, у
            которого есть права.
          </CardDescription>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="chip">Админ-панель</span>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Управление проектом
          </h1>
        </div>
        <Badge variant="muted">{me?.user?.tgUsername ?? "admin"}</Badge>
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm transition",
              tab === t.key
                ? "border-magic/45 bg-magic/15 text-ink shadow-glow"
                : "border-black/10 bg-white/[0.04] text-zinc-400 hover:text-ink"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={cn(
            "mb-5 rounded-2xl border px-4 py-3 text-sm",
            notice.kind === "ok"
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700"
              : "border-red-400/30 bg-red-500/10 text-red-600"
          )}
        >
          {notice.text}
        </div>
      )}

      {tab === "overview" && <OverviewTab toast={toast} />}
      {tab === "players" && <PlayersTab toast={toast} />}
      {tab === "payments" && <PaymentsTab toast={toast} />}
      {tab === "tickets" && <TicketsTab toast={toast} />}
      {tab === "seasons" && <SeasonsTab toast={toast} />}
      {tab === "logs" && <LogsTab />}
    </div>
  );
}

type Toast = (kind: "ok" | "err", text: string) => void;

function useData<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    load();
  }, [load, ...deps]);

  return { data, loading, error, reload: load };
}

function OverviewTab({ toast }: { toast: Toast }) {
  const { data, loading, reload } = useData<AdminStatsResponse>("/admin/stats");

  if (loading || !data) return <Skeleton className="h-72 w-full" />;

  const t = data.totals;
  const cards = [
    { label: "Выручка", value: formatKopecks(t.paidRevenueKopecks) },
    { label: "Оплаченных", value: String(t.paidCount) },
    { label: "Новых / продлений", value: `${t.newCount} / ${t.renewCount}` },
    { label: "Активных игроков", value: String(t.activePlayers) },
    { label: "Истекло", value: String(t.expiredPlayers) },
    { label: "Возвратов", value: formatKopecks(t.refundedKopecks) },
    { label: "Конверсия", value: `${Math.round(data.conversion.rate * 100)}%` },
    { label: "Ожидают оплаты", value: String(t.pendingPayments) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="glass p-5">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">
              {c.label}
            </div>
            <div className="mt-2 font-display text-xl font-bold text-ink">
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Последние платежи</CardTitle>
            <CardDescription>Обновление в реальном времени</CardDescription>
          </div>
          <Button variant="glass" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4" /> Обновить
          </Button>
        </CardHeader>
        <CardContent>
          <PaymentTable payments={data.recentPayments} compact />
        </CardContent>
      </Card>

      <BroadcastCard toast={toast} />
    </div>
  );
}

function BroadcastCard({ toast }: { toast: Toast }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"ACTIVE" | "ALL" | "EXPIRED">("ACTIVE");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (text.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ sent: number; failed: number }>("/admin/broadcast", {
        method: "POST",
        body: { text: text.trim(), target },
      });
      toast("ok", `Рассылка отправлена: ${res.sent}, ошибок: ${res.failed}`);
      setText("");
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-magic-dark" /> Рассылка
        </CardTitle>
        <CardDescription>Сообщение уйдёт всем выбранным игрокам в Telegram.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Текст сообщения (поддерживается HTML Telegram)…"
          maxLength={4000}
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["ACTIVE", "EXPIRED", "ALL"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={target === t ? "outline" : "glass"}
              onClick={() => setTarget(t)}
            >
              {t === "ACTIVE" ? "Активные" : t === "EXPIRED" ? "Истёкшие" : "Все"}
            </Button>
          ))}
          <Button onClick={() => void send()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            Отправить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayersTab({ toast }: { toast: Toast }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("");
  const query = `/admin/players?${new URLSearchParams({
    ...(filter ? { status: filter } : {}),
    ...(search ? { search } : {}),
  }).toString()}`;
  const { data, loading, reload } = useData<{
    players: {
      mcNick: string;
      status: string;
      tgId: string | null;
      tgUsername: string | null;
      firstName: string | null;
      expiresAt?: string | null;
      currentSeasonId: string | null;
      totalPaid: number;
      banReason?: string | null;
      createdAt: string;
    }[];
    total: number;
  }>(query, [filter, search]);

  const [banNick, setBanNick] = useState("");
  const [banReason, setBanReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ban = async (unban = false) => {
    const nick = banNick.trim();
    if (!nick) return;
    setBusy(true);
    try {
      await api(unban ? "/admin/players/unban" : "/admin/players/ban", {
        method: "POST",
        body: unban ? { nick } : { nick, reason: banReason.trim() || "Нарушение правил" },
      });
      toast("ok", unban ? `Бан снят с ${nick}` : `${nick} забанен и снят с whitelist`);
      setBanNick("");
      setBanReason("");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по нику…"
              className="pl-10"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-11 rounded-2xl border border-black/10 bg-white/[0.05] px-4 text-sm text-zinc-200 outline-none focus:border-magic/50"
          >
            <option value="">Все статусы</option>
            <option value="ACTIVE">Активные</option>
            <option value="EXPIRED">Истёкшие</option>
            <option value="PENDING">Ожидают</option>
            <option value="BANNED">Забаненные</option>
          </select>
          <Button variant="glass" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="hairline my-4" />

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <label className="mb-1.5 block text-xs uppercase tracking-widest text-zinc-500">
              Ник
            </label>
            <Input
              value={banNick}
              onChange={(e) => setBanNick(e.target.value.replace(/[^\w]/g, ""))}
              placeholder="Nick"
              className="h-10 font-mono"
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-xs uppercase tracking-widest text-zinc-500">
              Причина бана
            </label>
            <Input
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Читы, оскорбления…"
              className="h-10"
            />
          </div>
          <Button variant="danger" size="sm" onClick={() => void ban(false)} disabled={busy}>
            <Ban className="h-4 w-4" /> Забанить
          </Button>
          <Button variant="glass" size="sm" onClick={() => void ban(true)} disabled={busy}>
            <ShieldOff className="h-4 w-4" /> Разбанить
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Игроки ({data?.total ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                    <th className="pb-3 pr-4">Ник</th>
                    <th className="pb-3 pr-4">Telegram</th>
                    <th className="pb-3 pr-4">Статус</th>
                    <th className="pb-3 pr-4">Оплачено</th>
                    <th className="pb-3">Создан</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(data?.players ?? []).map((p) => (
                    <tr key={p.mcNick} className="text-zinc-300">
                      <td className="py-3 pr-4 font-mono text-ink">{p.mcNick}</td>
                      <td className="py-3 pr-4">
                        {p.tgUsername ? `@${p.tgUsername}` : p.tgId ?? "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-3 pr-4">{formatKopecks(p.totalPaid)}</td>
                      <td className="py-3 text-zinc-500">{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(data?.players.length ?? 0) === 0 && (
                <p className="py-6 text-center text-sm text-zinc-500">Ничего не найдено.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentsTab({ toast }: { toast: Toast }) {
  const [status, setStatus] = useState("");
  const [refundId, setRefundId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [busy, setBusy] = useState(false);

  const query = `/admin/payments?limit=100${status ? `&status=${status}` : ""}`;
  const { data, loading, reload } = useData<{ payments: PaymentDto[] }>(query, [status]);

  const refund = async () => {
    if (!refundId || refundReason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/admin/payments/${refundId}/refund`, {
        method: "POST",
        body: { reason: refundReason.trim() },
      });
      toast("ok", "Возврат выполнен");
      setRefundId(null);
      setRefundReason("");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const settle = async (id: string) => {
    setBusy(true);
    try {
      await api(`/admin/payments/${id}/settle`, { method: "POST" });
      toast("ok", "Платёж подтверждён вручную");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-11 rounded-2xl border border-black/10 bg-white/[0.05] px-4 text-sm text-zinc-200 outline-none focus:border-magic/50"
          >
            <option value="">Все статусы</option>
            <option value="PENDING">Ожидают</option>
            <option value="PAID">Оплаченные</option>
            <option value="REFUNDED">Возвраты</option>
            <option value="FAILED">Ошибки</option>
          </select>
          <Button variant="glass" size="sm" onClick={reload}>
            <RefreshCw className="h-4 w-4" /> Обновить
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Платежи</CardTitle>
          <CardDescription>
            Возврат — только вручную и только с причиной. Подтверждение вручную —
            для переносов из DonationAlerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                    <th className="pb-3 pr-4">Сумма</th>
                    <th className="pb-3 pr-4">Тип</th>
                    <th className="pb-3 pr-4">Источник</th>
                    <th className="pb-3 pr-4">Статус</th>
                    <th className="pb-3 pr-4">Дата</th>
                    <th className="pb-3">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(data?.payments ?? []).map((p) => (
                    <tr key={p.id} className="text-zinc-300">
                      <td className="py-3 pr-4 font-semibold text-ink">
                        {formatKopecks(p.amount)}
                      </td>
                      <td className="py-3 pr-4">{p.type}</td>
                      <td className="py-3 pr-4">
                        {p.provider === "YOOKASSA"
                          ? "карта/СБП"
                          : p.provider === "STARS"
                            ? "Stars"
                            : "вручную"}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-3 pr-4 text-zinc-500">{formatDate(p.createdAt)}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {p.status === "PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void settle(p.id)}
                            >
                              Подтвердить
                            </Button>
                          )}
                          {p.status === "PAID" && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => setRefundId(p.id)}
                            >
                              Возврат
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(data?.payments.length ?? 0) === 0 && (
                <p className="py-6 text-center text-sm text-zinc-500">Платежей нет.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {refundId && (
        <Card className="border-red-400/30 p-5">
          <CardTitle className="text-base">Возврат платежа</CardTitle>
          <CardDescription className="mt-1">
            Укажи причину — она сохранится в журнале аудита.
          </CardDescription>
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="min-w-[280px] flex-1">
              <Textarea
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Например: технический сбой, игрок не получил доступ…"
                maxLength={500}
                className="min-h-[80px]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={busy || refundReason.trim().length < 3}
                onClick={() => void refund()}
              >
                Подтвердить возврат
              </Button>
              <Button variant="ghost" onClick={() => setRefundId(null)}>
                Отмена
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function TicketsTab({ toast }: { toast: Toast }) {
  const [filter, setFilter] = useState("");
  const query = `/admin/tickets${filter ? `?status=${filter}` : ""}`;
  const { data, loading, reload } = useData<{ tickets: AdminTicketDetail[] }>(query, [
    filter,
  ]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async (
    id: string,
    status: "APPROVED" | "REJECTED" | "CLOSED"
  ) => {
    setBusy(true);
    try {
      await api(`/admin/tickets/${id}/resolve`, {
        method: "POST",
        body: { status, note: note.trim() || undefined },
      });
      toast("ok", `Тикет: ${status}`);
      setNote("");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const [nickRequests, setNickRequests] = useState<NickRequestDetail[]>([]);
  const [nickLoading, setNickLoading] = useState(true);

  const loadNickRequests = useCallback(() => {
    setNickLoading(true);
    api<{ requests: NickRequestDetail[] }>("/admin/nick-requests?status=OPEN")
      .then((r) => setNickRequests(r.requests))
      .catch(() => undefined)
      .finally(() => setNickLoading(false));
  }, []);

  useEffect(() => {
    loadNickRequests();
  }, [loadNickRequests]);

  const nickAction = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    try {
      await api(`/admin/nick-requests/${id}/${action}`, { method: "POST" });
      toast("ok", action === "approve" ? "Ник одобрен" : "Заявка отклонена");
      loadNickRequests();
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Заявки на смену ника</CardTitle>
            <CardDescription>Открытые — требуют решения модератора.</CardDescription>
          </div>
          <Button variant="glass" size="sm" onClick={loadNickRequests}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {nickLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : nickRequests.length === 0 ? (
            <p className="text-sm text-zinc-500">Открытых заявок нет.</p>
          ) : (
            <ul className="space-y-3">
              {nickRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/8 bg-white/[0.04] p-4"
                >
                  <div className="text-sm">
                    <span className="font-mono text-ink">{r.oldNick ?? "—"}</span>
                    <span className="mx-2 text-magic-dark">→</span>
                    <span className="font-mono text-ink">{r.newNick}</span>
                    <div className="text-xs text-zinc-500">
                      {r.user.tgUsername ? `@${r.user.tgUsername}` : r.user.tgId} ·{" "}
                      {formatDate(r.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void nickAction(r.id, "approve")}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Одобрить
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void nickAction(r.id, "reject")}
                    >
                      Отклонить
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Тикеты</CardTitle>
            <CardDescription>Поддержка и запросы возврата.</CardDescription>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 rounded-xl border border-black/10 bg-white/[0.05] px-3 text-xs text-zinc-200 outline-none"
          >
            <option value="">Все</option>
            <option value="OPEN">Открытые</option>
            <option value="APPROVED">Одобренные</option>
            <option value="REJECTED">Отклонённые</option>
            <option value="CLOSED">Закрытые</option>
          </select>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Комментарий к решению (виден игроку)…"
            maxLength={500}
            className="min-h-[70px]"
          />
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (data?.tickets.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">Тикетов нет.</p>
          ) : (
            <ul className="space-y-3">
              {data!.tickets.map((t) => (
                <li
                  key={t.id}
                  className="rounded-2xl border border-black/8 bg-white/[0.04] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-ink">
                      {t.type} · {t.user.tgUsername ? `@${t.user.tgUsername}` : t.user.tgId}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.status === "OPEN" ? "warning" : "muted"}>
                        {t.status}
                      </Badge>
                      <span className="text-xs text-zinc-500">{formatDate(t.createdAt)}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-zinc-300">
                    {String(t.payload?.text ?? "—")}
                  </p>
                  {t.status === "OPEN" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void resolve(t.id, "APPROVED")}
                      >
                        Одобрить
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void resolve(t.id, "REJECTED")}
                      >
                        Отклонить
                      </Button>
                      <Button
                        size="sm"
                        variant="glass"
                        disabled={busy}
                        onClick={() => void resolve(t.id, "CLOSED")}
                      >
                        Закрыть
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SeasonsTab({ toast }: { toast: Toast }) {
  const { data, loading, reload } = useData<AdminStatsResponse>("/admin/stats");
  const [name, setName] = useState("");
  const [priceNew, setPriceNew] = useState("500");
  const [priceRenew, setPriceRenew] = useState("200");
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    if (name.trim().length < 2) {
      toast("err", "Назови сезон (минимум 2 символа)");
      return;
    }
    setBusy(true);
    try {
      await api("/admin/seasons/wipe", {
        method: "POST",
        body: {
          name: name.trim(),
          priceNew: Math.round(Number(priceNew) * 100) || DEFAULT_PRICE_NEW_KOPECKS,
          priceRenew:
            Math.round(Number(priceRenew) * 100) || DEFAULT_PRICE_RENEW_KOPECKS,
        },
      });
      toast("ok", "Вайп объявлен: новый сезон открыт, проходки сброшены");
      setName("");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closeSeason = async (id: string) => {
    setBusy(true);
    try {
      await api(`/admin/seasons/${id}/close`, { method: "POST" });
      toast("ok", "Сезон закрыт");
      reload();
    } catch (e) {
      toast("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Текущий сезон</CardTitle>
          <CardDescription>
            Вайп открывает новый сезон и сбрасывает проходки: активные игроки
            платят продление, новые — полную цену.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !data ? (
            <Skeleton className="h-24 w-full" />
          ) : data.season ? (
            <div className="space-y-3 text-sm">
              <Row label="Номер" value={String(data.season.number)} />
              <Row label="Название" value={data.season.name} />
              <Row label="Цена новая" value={formatKopecks(data.season.priceNew)} />
              <Row label="Цена продления" value={formatKopecks(data.season.priceRenew)} />
              <Row
                label="Начало"
                value={new Date(data.season.startedAt).toLocaleDateString("ru-RU")}
              />
              <div className="pt-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void closeSeason(data.season!.id)}
                >
                  Закрыть сезон
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Активного сезона нет.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Объявить вайп</CardTitle>
          <CardDescription>
            Создаётся новый сезон, текущие проходки становятся неактуальными,
            whitelist очищается.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-widest text-zinc-500">
              Название сезона
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Сезон 5 · Зима"
              maxLength={60}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-widest text-zinc-500">
                Новая, ₽
              </label>
              <Input value={priceNew} onChange={(e) => setPriceNew(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-widest text-zinc-500">
                Продление, ₽
              </label>
              <Input value={priceRenew} onChange={(e) => setPriceRenew(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <Button className="w-full" disabled={busy} onClick={() => void wipe()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ServerCog className="h-4 w-4" />}
            Объявить вайп
          </Button>
          <p className="text-xs text-zinc-500">
            Игроки получат уведомление в боте о начале нового сезона.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Сезоны</CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !data ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                    <th className="pb-3 pr-4">#</th>
                    <th className="pb-3 pr-4">Название</th>
                    <th className="pb-3 pr-4">Цены</th>
                    <th className="pb-3 pr-4">Начало</th>
                    <th className="pb-3">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.seasons.map((s: SeasonDto) => (
                    <tr key={s.id} className="text-zinc-300">
                      <td className="py-3 pr-4 font-semibold text-ink">{s.number}</td>
                      <td className="py-3 pr-4">{s.name}</td>
                      <td className="py-3 pr-4">
                        {formatKopecks(s.priceNew)} / {formatKopecks(s.priceRenew)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-500">
                        {new Date(s.startedAt).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="py-3">
                        <Badge variant={s.isActive ? "success" : "muted"}>
                          {s.isActive ? "активен" : "закрыт"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogsTab() {
  const wl = useData<{
    log: { id: string; action: string; mcNick: string; ok: boolean; message: string | null; at: string }[];
  }>("/admin/whitelist-log");
  const audit = useData<{
    audit: { id: string; action: string; actorTgId: number | null; createdAt: string }[];
  }>("/admin/audit");

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Журнал whitelist</CardTitle>
          <CardDescription>Команды add/remove, которые выполнял сервер.</CardDescription>
        </CardHeader>
        <CardContent>
          {wl.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="space-y-2">
              {(wl.data?.log ?? []).slice(0, 40).map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-black/8 bg-white/[0.03] px-3 py-2 text-xs"
                >
                  <span className="font-mono text-zinc-200">
                    {l.action} {l.mcNick}
                  </span>
                  <span className={l.ok ? "text-emerald-700" : "text-red-600"}>
                    {l.ok ? "ok" : l.message ?? "err"}
                  </span>
                </li>
              ))}
              {(wl.data?.log.length ?? 0) === 0 && (
                <p className="text-sm text-zinc-500">Пока пусто.</p>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Журнал аудита</CardTitle>
          <CardDescription>Действия администраторов: возвраты, баны, вайпы.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="space-y-2">
              {(audit.data?.audit ?? []).slice(0, 40).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-black/8 bg-white/[0.03] px-3 py-2 text-xs"
                >
                  <span className="text-zinc-200">{a.action}</span>
                  <span className="text-zinc-500">
                    {a.actorTgId ? `#${a.actorTgId} · ` : ""}
                    {formatDate(a.createdAt)}
                  </span>
                </li>
              ))}
              {(audit.data?.audit.length ?? 0) === 0 && (
                <p className="text-sm text-zinc-500">Пока пусто.</p>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentTable({
  payments,
  compact,
}: {
  payments: PaymentDto[];
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
            <th className="pb-3 pr-4">Сумма</th>
            <th className="pb-3 pr-4">Тип</th>
            <th className="pb-3 pr-4">Статус</th>
            <th className="pb-3">Дата</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {payments.slice(0, compact ? 8 : 50).map((p) => (
            <tr key={p.id} className="text-zinc-300">
              <td className="py-3 pr-4 font-semibold text-ink">{formatKopecks(p.amount)}</td>
              <td className="py-3 pr-4">{p.type}</td>
              <td className="py-3 pr-4">
                <StatusBadge status={p.status} />
              </td>
              <td className="py-3 text-zinc-500">{formatDate(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {payments.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-500">Платежей пока нет.</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "PAID" || status === "ACTIVE"
      ? "success"
      : status === "PENDING"
        ? "warning"
        : status === "BANNED" || status === "FAILED"
          ? "danger"
          : "muted";
  return <Badge variant={variant}>{status}</Badge>;
}
