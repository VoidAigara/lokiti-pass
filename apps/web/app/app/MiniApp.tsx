"use client";

// Telegram Mini App: отдельный интерфейс под веб-вью Telegram
// (не лендинг сайта). Тёмная плотная тема, нижние табы, автологин по initData
// (AuthProvider в корневом layout), оплата через API.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Copy,
  Gamepad2,
  History,
  LifeBuoy,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import { MC_NICK_REGEX, type MeResponse, type TicketDto } from "@loki/shared";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  api,
  createPayment,
  errorMessage,
  getStatus,
  getSeason,
} from "@/lib/api";
import { daysLeft, formatDate, formatKopecks } from "@/lib/utils";
import { deepLink, haptic, notify, openBot } from "@/lib/telegram";
import type { PublicSeasonResponse, PublicStatusResponse } from "@/lib/types";

type Tab = "profile" | "buy" | "server";

const NICK_RE = MC_NICK_REGEX;

export function MiniApp() {
  const { status, me, refresh, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");

  if (status === "idle" || status === "loading") {
    return <Splash />;
  }

  if (status === "anon" || status === "error" || !me) {
    return <OutsideTelegram />;
  }

  return (
    <div className="ma-root">
      <header className="ma-top">
        <div className="ma-brand">
          <span className="ma-brand-mark">L</span>
          <span className="ma-brand-text">LOKI TI · PASS</span>
        </div>
        <button
          type="button"
          className="ma-refresh"
          onClick={() => {
            haptic("light");
            void refresh();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      <main className="ma-body">
        {tab === "profile" && (
          <ProfileScreen me={me} onBuy={() => setTab("buy")} />
        )}
        {tab === "buy" && <BuyScreen me={me} onDone={() => void refresh()} />}
        {tab === "server" && <ServerScreen />}
      </main>

      <nav className="ma-tabs">
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          icon={<UserRound className="h-5 w-5" />}
          label="Профиль"
        />
        <TabButton
          active={tab === "buy"}
          onClick={() => setTab("buy")}
          icon={<Sparkles className="h-5 w-5" />}
          label="Купить"
          accent
        />
        <TabButton
          active={tab === "server"}
          onClick={() => setTab("server")}
          icon={<Server className="h-5 w-5" />}
          label="Сервер"
        />
      </nav>

      <button type="button" className="ma-logout" onClick={() => void logout()}>
        <LogOut className="h-3.5 w-3.5" /> Выйти
      </button>
    </div>
  );
}

// ------------------------------------------------------------- screens

function ProfileScreen({
  me,
  onBuy,
}: {
  me: MeResponse;
  onBuy: () => void;
}) {
  const p = me.player;
  const offer = me.offer;
  const active = p?.status === "ACTIVE";
  const left = daysLeft(p?.currentSeason?.endedAt);

  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [ticketText, setTicketText] = useState("");
  const [ticketType, setTicketType] = useState<"SUPPORT" | "REFUND_REQUEST">(
    "SUPPORT"
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadTickets = useCallback(async () => {
    try {
      const res = await api<{ tickets: TicketDto[] }>("/me/tickets");
      setTickets(res.tickets);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const submitTicket = async () => {
    if (ticketText.trim().length < 3) {
      setMsg({ ok: false, text: "Опиши вопрос подробнее (3+ символа)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/me/tickets", {
        method: "POST",
        body: { type: ticketType, text: ticketText.trim() },
      });
      notify("success");
      setMsg({ ok: true, text: "Отправлено. Ответ придёт в Telegram." });
      setTicketText("");
      void loadTickets();
    } catch (err) {
      notify("error");
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ma-screen">
      <section className="ma-hero">
        <div className="ma-avatar">
          {(me.user.firstName ?? "L").slice(0, 1).toUpperCase()}
        </div>
        <div className="ma-hero-info">
          <div className="ma-hero-name">
            {me.user.firstName ?? "Игрок"}
            {me.user.tgUsername && (
              <span className="ma-hero-handle">@{me.user.tgUsername}</span>
            )}
          </div>
          <div className="ma-hero-chips">
            <span className={`ma-chip ${active ? "ma-chip-ok" : "ma-chip-warn"}`}>
              {active ? (
                <>
                  <BadgeCheck className="h-3 w-3" /> проходка активна
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3" /> {p?.status ?? "нет доступа"}
                </>
              )}
            </span>
            {p?.mcNick && <span className="ma-chip ma-chip-mute">{p.mcNick}</span>}
          </div>
        </div>
      </section>

      <section className="ma-grid">
        <Metric label="Ник" value={p?.mcNick ?? "—"} icon={<UserRound className="h-3.5 w-3.5" />} />
        <Metric
          label="Сезон"
          value={p?.currentSeason ? `${p.currentSeason.number}. ${p.currentSeason.name}` : "—"}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Доступ до"
          value={p?.currentSeason?.endedAt ? formatDate(p.currentSeason.endedAt) : "до вайпа"}
          sub={left !== null ? `осталось ${left} дн.` : undefined}
          icon={<BadgeCheck className="h-3.5 w-3.5" />}
        />
        <Metric
          label="Оплачено"
          value={formatKopecks(p?.totalPaid ?? 0)}
          sub={p?.renewalCount ? `продлений: ${p.renewalCount}` : undefined}
          icon={<History className="h-3.5 w-3.5" />}
        />
      </section>

      {offer.kind !== "ALREADY_ACTIVE" && (
        <button type="button" className="ma-cta" onClick={onBuy}>
          <div>
            <div className="ma-cta-label">
              {offer.kind === "RENEW"
                ? "Продление после вайпа"
                : offer.kind === "NO_SEASON"
                  ? "Сезон скоро откроется"
                  : "Купи доступ на whitelist"}
            </div>
            <div className="ma-cta-price">{formatKopecks(offer.amount)}</div>
          </div>
          <ArrowRight className="h-5 w-5" />
        </button>
      )}

      <section className="ma-block">
        <h2 className="ma-block-title">
          <History className="h-4 w-4" /> Платежи
        </h2>
        {me.payments.length === 0 ? (
          <p className="ma-empty">Платежей пока нет.</p>
        ) : (
          <ul className="ma-paylist">
            {me.payments.slice(0, 6).map((pay) => (
              <li key={pay.id} className="ma-payrow">
                <div>
                  <div className="ma-payrow-sum">
                    {formatKopecks(pay.amount)}{" "}
                    <span className="ma-payrow-kind">
                      · {pay.provider === "STARS" ? "Stars" : pay.provider === "YOOKASSA" ? "карта/СБП" : "вручную"}
                    </span>
                  </div>
                  <div className="ma-payrow-date">{formatDate(pay.createdAt)}</div>
                </div>
                <span
                  className={`ma-chip ${
                    pay.status === "PAID"
                      ? "ma-chip-ok"
                      : pay.status === "PENDING"
                        ? "ma-chip-warn"
                        : "ma-chip-mute"
                  }`}
                >
                  {pay.status === "PAID" ? "оплачен" : pay.status === "PENDING" ? "ждёт" : pay.status === "REFUNDED" ? "возврат" : pay.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ma-block">
        <h2 className="ma-block-title">
          <Send className="h-4 w-4" /> Обращение
        </h2>
        <div className="ma-seg ma-seg-sm">
          <button
            type="button"
            className={ticketType === "SUPPORT" ? "on" : ""}
            onClick={() => setTicketType("SUPPORT")}
          >
            Вопрос
          </button>
          <button
            type="button"
            className={ticketType === "REFUND_REQUEST" ? "on" : ""}
            onClick={() => setTicketType("REFUND_REQUEST")}
          >
            Возврат
          </button>
        </div>
        <Textarea
          value={ticketText}
          onChange={(e) => setTicketText(e.target.value)}
          placeholder={
            ticketType === "SUPPORT"
              ? "Опиши вопрос: что случилось…"
              : "Укажи платёж и причину возврата…"
          }
          maxLength={2000}
          className="ma-textarea"
        />
        {msg && (
          <p className={msg.ok ? "ma-msg-ok" : "ma-msg-bad"}>{msg.text}</p>
        )}
        <Button className="w-full" onClick={() => void submitTicket()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Отправить
        </Button>
        {tickets.length > 0 && (
          <ul className="ma-ticketlist">
            {tickets.slice(0, 4).map((t) => (
              <li key={t.id}>
                <span>{t.type === "REFUND_REQUEST" ? "возврат" : "вопрос"}</span>
                <span className="ma-empty">
                  {t.status} · {formatDate(t.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BuyScreen({ me, onDone }: { me: MeResponse; onDone: () => void }) {
  const [kind, setKind] = useState<"NEW" | "RENEW">(
    me.offer.kind === "RENEW" ? "RENEW" : "NEW"
  );
  const [nick, setNick] = useState(me.player?.mcNick ?? "");
  const [nickError, setNickError] = useState<string | null>(null);
  const [season, setSeason] = useState<PublicSeasonResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSeason().then(setSeason).catch(() => undefined);
  }, []);

  const prices = season?.prices;
  const amount =
    kind === "NEW"
      ? (prices?.new ?? me.offer.amount)
      : (prices?.renew ?? me.offer.amount);

  const locked = me.offer.kind === "ALREADY_ACTIVE";
  const noSeason = me.offer.kind === "NO_SEASON";

  const pay = async (provider: "yookassa" | "stars") => {
    haptic("medium");
    setError(null);
    setBusy(true);
    try {
      if (kind === "NEW" && !me.player?.mcNick) {
        if (!NICK_RE.test(nick)) {
          setNickError("Ник: 3–16 символов, латиница, цифры и _.");
          return;
        }
        await api("/me/nick", { method: "POST", body: { mcNick: nick } });
        onDone();
      }

      if (provider === "stars") {
        // Инвойс Stars умеет слать только бот — deep-link сразу к оплате.
        notify("success");
        openBot(kind === "RENEW" ? "?start=stars_renew" : "?start=stars");
        return;
      }

      const res = await createPayment({
        type: kind,
        mcNick: me.player?.mcNick ? undefined : nick,
      });
      notify("success");
      if (res.confirmationUrl) {
        const tg = window.Telegram?.WebApp;
        if (tg?.openLink) tg.openLink(res.confirmationUrl);
        else window.open(res.confirmationUrl, "_blank", "noopener,noreferrer");
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

  if (locked || noSeason) {
    return (
      <div className="ma-screen">
        <div className="ma-block ma-center">
          <CheckCircle2 className="ma-big-ok" />
          <p className="ma-block-title" style={{ justifyContent: "center" }}>
            {locked ? "Проходка уже активна" : "Сезон пока не открыт"}
          </p>
          <p className="ma-empty">
            {locked
              ? "Доступ действует до конца сезона — вайп объявим в боте."
              : "Объявим вайп в боте — продление станет доступно."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ma-screen">
      <div className="ma-seg">
        {(["NEW", "RENEW"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? "on" : ""}
            onClick={() => {
              haptic("light");
              setKind(k);
            }}
          >
            <span>{k === "NEW" ? "Новый" : "Продление"}</span>
            <span className="ma-seg-price">
              {formatKopecks(k === "NEW" ? (prices?.new ?? 0) : (prices?.renew ?? 0))}
            </span>
          </button>
        ))}
      </div>

      <section className="ma-block">
        <h2 className="ma-block-title">
          <Gamepad2 className="h-4 w-4" /> Minecraft-ник
        </h2>
        {me.player?.mcNick ? (
          <div className="ma-nick-locked">
            {me.player.mcNick} <BadgeCheck className="h-4 w-4" />
          </div>
        ) : (
          <>
            <Input
              value={nick}
              onChange={(e) => {
                setNick(e.target.value.replace(/[^\w]/g, ""));
                setNickError(null);
              }}
              placeholder="Steve_2024"
              maxLength={16}
              className="ma-input"
              autoComplete="off"
            />
            {nickError && <p className="ma-msg-bad">{nickError}</p>}
          </>
        )}
      </section>

      <section className="ma-pricecard">
        <div className="ma-pricecard-label">
          {kind === "NEW" ? "Первый вход" : "Продление после вайпа"}
        </div>
        <div className="ma-pricecard-sum">{formatKopecks(amount)}</div>
        <ul className="ma-pricecard-list">
          {[
            "Whitelist до конца сезона",
            "Выдача автоматически, ~30 сек",
            "История платежей в профиле",
          ].map((t) => (
            <li key={t}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {t}
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="ma-msg-bad">{error}</p>}

      <div className="ma-payactions">
        <Button size="lg" className="w-full" disabled={busy} onClick={() => void pay("yookassa")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Картой / СБП — {formatKopecks(amount)}
        </Button>
        <Button
          variant="glass"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => void pay("stars")}
        >
          <Sparkles className="h-4 w-4" /> Telegram Stars
        </Button>
      </div>

      <p className="ma-legal">
        Оплата — на сайте возвращаться не нужно: подтверди платёж, доступ
        придёт сам. <a href="/refund">Условия возврата</a>
      </p>
    </div>
  );
}

function ServerScreen() {
  const [status, setStatus] = useState<PublicStatusResponse | null>(null);
  const [season, setSeason] = useState<PublicSeasonResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    getStatus().then(setStatus).catch(() => undefined);
    getSeason().then(setSeason).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const copyIp = () => {
    const ip = status?.serverIp ?? season?.serverIp;
    if (!ip) return;
    void navigator.clipboard?.writeText(ip).then(() => {
      haptic("light");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const online = status?.ok;

  return (
    <div className="ma-screen">
      <section className={`ma-status ${online ? "ma-status-ok" : "ma-status-off"}`}>
        <div className="ma-status-head">
          <span className={`ma-dot ${online ? "on" : "off"}`} />
          <span className="ma-status-text">
            {online ? "Сервер онлайн" : "Сервер недоступен"}
          </span>
          <span className="ma-status-count">
            {online ? `${status?.online ?? 0} / ${status?.max ?? "—"}` : "—"}
          </span>
        </div>
        <button type="button" className="ma-ip" onClick={copyIp}>
          <span className="ma-ip-label">IP</span>
          <span className="ma-ip-value">{status?.serverIp ?? season?.serverIp ?? "play.lokiti.ru"}</span>
          {copied ? (
            <CheckCircle2 className="h-4 w-4 ma-ip-ic" />
          ) : (
            <Copy className="h-4 w-4 ma-ip-ic" />
          )}
        </button>
        <div className="ma-status-meta">
          <span>Сезон {season?.season ? `${season.season.number}. ${season.season.name}` : "…"}</span>
          <span>{status?.version ?? (online ? "Java" : "—")}</span>
        </div>
      </section>

      <section className="ma-block">
        <h2 className="ma-block-title">
          <LifeBuoy className="h-4 w-4" /> Связь
        </h2>
        <div className="ma-actions">
          <Button className="flex-1" onClick={() => openBot("/support")}>
            <LifeBuoy className="h-4 w-4" /> Поддержка
          </Button>
          <a href={deepLink("/start")} target="_blank" rel="noreferrer">
            <Button variant="glass">
              <Gamepad2 className="h-4 w-4" /> Бот
            </Button>
          </a>
        </div>
        <p className="ma-empty">
          Правила и возвраты — на сайте проекта, ссылки в боте и в описании
          проходки.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------- pieces

function TabButton({
  active,
  onClick,
  icon,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ma-tab ${active ? "on" : ""} ${accent ? "ma-tab-accent" : ""}`}
      onClick={() => {
        haptic("light");
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Metric({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="ma-metric">
      <div className="ma-metric-label">
        <span className="ma-metric-ic">{icon}</span> {label}
      </div>
      <div className="ma-metric-value">{value}</div>
      {sub && <div className="ma-metric-sub">{sub}</div>}
    </div>
  );
}

function Splash() {
  return (
    <div className="ma-root ma-splash">
      <Loader2 className="h-6 w-6 animate-spin text-[#FF3366]" />
    </div>
  );
}

function OutsideTelegram() {
  return (
    <div className="ma-root ma-splash">
      <div className="ma-gate">
        <Sparkles className="ma-gate-ic" />
        <h1>Кабинет Loki Ti</h1>
        <p>Открой кабинет внутри Telegram — вход произойдёт автоматически.</p>
        <Button onClick={() => openBot("/start")}>
          <Gamepad2 className="h-4 w-4" /> Открыть бота
        </Button>
      </div>
    </div>
  );
}
