"use client";

import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { deepLink } from "@/lib/telegram";

const faq = [
  {
    q: "Как быстро приходит доступ после оплаты?",
    a: "Автоматически: как только платёж подтверждается (обычно 5–30 секунд), сервер добавляет ник в whitelist. Бот пришлёт уведомление, а в личном кабинете появится статус «Активен».",
  },
  {
    q: "Что происходит при вайпе?",
    a: "Вайп открывает новый сезон: старые проходки становятся неактуальными, но история платежей сохраняется. После вайпа доступ продлевается по сниженной цене — и только в том сезоне.",
  },
  {
    q: "Можно ли оплатить Telegram Stars?",
    a: "Да. В боте есть кнопка «Оплатить Stars» — инвойс придёт прямо в чат. Сумма пересчитывается по курсу и списывается с баланса Stars.",
  },
  {
    q: "Как сменить Minecraft-ник?",
    a: "Один Telegram-аккаунт — один ник. Смена возможна через команду /nick: создаётся заявка, и модератор одобряет её вручную. Первая привязка ника — сразу при покупке.",
  },
  {
    q: "Как вернуть деньги?",
    a: "Возврат оформляется вручную: напиши /refund в боте или создай тикет в поддержке. Условия и сроки описаны на странице «Возврат средств». Решение принимает модератор с указанием причины.",
  },
  {
    q: "Это официальный сервер Mojang?",
    a: "Нет. Loki Ti — независимый фанатский проект, не связанный с Mojang, Minecraft и Microsoft.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip justify-center">FAQ</span>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Частые вопросы
          </h2>
        </div>

        <div className="mx-auto mt-10 max-w-3xl">
          <Accordion type="single" collapsible className="border-t border-line">
            {faq.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger>
                  <span className="flex-1">{f.q}</span>
                </AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <div className="mx-auto mt-8 flex max-w-3xl flex-col items-start gap-4 rounded-2xl border border-line bg-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">
              Не нашёл ответ?
            </div>
            <p className="mt-1 text-sm text-faint">
              Поддержка отвечает в боте — обычно за пару минут.
            </p>
          </div>
          <Link href={deepLink("/support")} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              Написать в поддержку
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
