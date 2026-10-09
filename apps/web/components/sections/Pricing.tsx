"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Gem, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSeason } from "@/lib/api";
import { formatKopecks } from "@/lib/utils";
import type { SeasonDto } from "@loki/shared";

const benefits = [
  "Whitelist на весь сезон",
  "Автоматическая выдача доступа",
  "Личный кабинет и история оплат",
  "Поддержка в боте 24/7",
];

function PriceCard({
  delay,
  title,
  note,
  price,
  item,
  itemAlt,
  desc,
  list,
  cta,
  href,
  primary,
}: {
  delay: number;
  title: string;
  note: string;
  price: string;
  item: React.ReactNode;
  itemAlt: string;
  desc: string;
  list: string[];
  cta: string;
  href: string;
  primary?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay }}
      className="glass relative flex flex-col p-6 sm:p-7"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] text-faint">
          {note}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-soft text-faint">
          {item}
        </div>
        <div className="min-w-0">
          <div className="font-display text-4xl font-bold tracking-tight text-ink sm:text-[2.75rem]">
            {price}
          </div>
          <div className="mt-1 text-xs text-faint">{itemAlt}</div>
        </div>
      </div>

      <p className="mt-4 text-sm text-body">{desc}</p>

      <ul className="mt-6 flex-1 space-y-3">
        {list.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-sm text-body">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-magic" />
            {b}
          </li>
        ))}
      </ul>

      <Link href={href} className="mt-7">
        <Button
          variant={primary ? "default" : "outline"}
          size="lg"
          className="w-full"
        >
          {cta}
        </Button>
      </Link>
    </motion.div>
  );
}

export function Pricing() {
  const [season, setSeason] = useState<SeasonDto | null>(null);
  const [prices, setPrices] = useState({ new: 50_000, renew: 20_000 });

  useEffect(() => {
    getSeason()
      .then((r) => {
        setSeason(r.season);
        setPrices(r.prices);
      })
      .catch(() => undefined);
  }, []);

  return (
    <section id="pricing" className="relative scroll-mt-24 py-8 sm:py-14">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip justify-center">Цена</span>
          <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Две цены, ноль сюрпризов
          </h2>
          <p className="mt-4 text-body">
            {season
              ? `Сезон ${season.number}: ${season.name}`
              : "Первая проходка — для новых игроков, продление — после вайпа."}
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
          <PriceCard
            delay={0}
            title="Первая проходка"
            note="для новых"
            price={formatKopecks(prices.new)}
            item={<Gem className="h-6 w-6" />}
            itemAlt="вход на текущий сезон"
            desc="Новый игрок: привязка ника и вход на текущий сезон."
            list={benefits}
            cta="Купить проходку"
            href="/buy"
            primary
          />

          <PriceCard
            delay={0.1}
            title="Продление"
            note="после вайпа"
            price={formatKopecks(prices.renew)}
            item={<RefreshCcw className="h-6 w-6" />}
            itemAlt="тот же ник и статистика"
            desc="Для тех, кто уже играл: продление после вайпа по старому нику."
            list={[benefits[1], benefits[2], benefits[3], "Тот же ник и статистика"]}
            cta="Продлить проходку"
            href="/buy?tab=renew"
          />
        </div>

        <p className="mx-auto mt-6 max-w-4xl text-center text-xs text-faint">
          Проходка действует до конца сезона. Возврат — по{" "}
          <Link
            href="/refund"
            className="text-magic-dark underline-offset-2 hover:underline"
          >
            правилам возврата
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
