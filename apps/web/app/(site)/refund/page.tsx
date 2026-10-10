import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Clock3, MessageSquareWarning } from "lucide-react";

export const metadata: Metadata = {
  title: "Возврат средств",
  description:
    "Условия и порядок возврата средств за проходку на сервере Loki Ti.",
  alternates: { canonical: "/refund" },
};

const rules = [
  {
    icon: Clock3,
    title: "Срок обращения",
    text: "Запрос возврата можно оставить в течение 14 дней с момента оплаты и до вайпа сезона.",
  },
  {
    icon: Banknote,
    title: "Когда возврат возможен",
    text: "Технические проблемы: доступ не выдан, сервер недоступен более 72 часов подряд по вине проекта, двойное списывание.",
  },
  {
    icon: MessageSquareWarning,
    title: "Когда возврат невозможен",
    text: "После начала сезона (доступ уже предоставлен), за нарушение правил, за бан аккаунта, если проходка куплена по ошибочному нику и ник не был использован.",
  },
];

const steps = [
  "Напиши /refund в боте или открой личный кабинет → «Обращение» → «Запрос возврата».",
  "Укажи причину и приложи данные платежа (сумма и дата).",
  "Модератор рассмотрит обращение в течение 3 рабочих дней и ответит в Telegram.",
  "При одобрении возврат выполняется тем же способом, которым была оплата (обычно до 10 рабочих дней).",
];

export default function RefundPage() {
  return (
    <div className="container max-w-4xl py-14">
      <span className="chip">Документы</span>
      <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Возврат средств
      </h1>
      <p className="mt-4 text-body">
        Мы ценим доверие игроков. Ниже — понятные условия возврата без мелкого
        шрифта.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {rules.map((r) => (
          <div key={r.title} className="glass p-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-soft text-faint">
              <r.icon className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-display text-base font-semibold text-ink">
              {r.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-body">{r.text}</p>
          </div>
        ))}
      </div>

      <section className="glass mt-8 p-6 sm:p-8">
        <h2 className="font-display text-xl font-semibold text-ink">
          Как оформить возврат
        </h2>
        <ol className="mt-5 space-y-4">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-4">
              <span className="font-mono text-xs font-semibold text-magic">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm leading-relaxed text-body">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-faint">
        Возврат оформляется вручную модератором с указанием причины — все решения
        фиксируются в журнале аудита проекта. Проект не является юридическим лицом
        и не выдаёт кассовые чеки.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/profile" className="btn-primary px-5 py-3 text-sm">
          Оставить запрос
        </Link>
        <Link
          href="/rules"
          className="btn-ghost px-5 py-3 text-sm"
        >
          Правила сервера
        </Link>
      </div>
    </div>
  );
}
