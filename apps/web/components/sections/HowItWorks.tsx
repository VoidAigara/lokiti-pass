"use client";

import { motion } from "framer-motion";
import { CreditCard, Gamepad2, Sparkles, UserCheck } from "lucide-react";

const steps = [
  {
    icon: UserCheck,
    title: "Привяжи ник",
    text: "Укажи свой Minecraft-ник один раз — он закрепится за твоим Telegram-аккаунтом.",
  },
  {
    icon: CreditCard,
    title: "Оплати проходку",
    text: "Карта, СБП или Telegram Stars. Одна сумма, без скрытых комиссий и доплат.",
  },
  {
    icon: Sparkles,
    title: "Получи доступ",
    text: "Сервер добавит тебя в whitelist автоматически в течение 30 секунд после оплаты.",
  },
  {
    icon: Gamepad2,
    title: "Играй весь сезон",
    text: "Доступ действует до вайпа. После вайпа просто продли проходку по сниженной цене.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip justify-center">Как это работает</span>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Четыре шага до игры
          </h2>
          <p className="mt-4 text-body">
            Вся автоматика на нашей стороне: админам писать не нужно.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="glass glass-hover p-6"
            >
              <div className="flex items-center justify-between">
                <s.icon className="h-5 w-5 text-faint" />
                <span className="font-mono text-xs font-semibold text-magic">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 font-display text-[15px] font-semibold text-ink">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-body">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
