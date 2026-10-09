"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Check, Copy, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSeason, getStatus } from "@/lib/api";
import { formatKopecks } from "@/lib/utils";
import { haptic } from "@/lib/telegram";

const serverIp = process.env.NEXT_PUBLIC_MC_IP ?? "play.lokiti.ru";

const facts = [
  { icon: ShieldCheck, label: "Whitelist-вход" },
  { icon: RotateCcw, label: "Сезонный вайп" },
  { icon: Zap, label: "Выдача за 30 сек" },
];

export function Hero() {
  const [copied, setCopied] = useState(false);
  const [prices, setPrices] = useState({ new: 50_000, renew: 20_000 });
  const [season, setSeason] = useState<string | null>(null);
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getSeason()
      .then((r) => {
        if (!alive) return;
        setPrices(r.prices);
        setSeason(
          r.season ? `Сезон ${r.season.number}: ${r.season.name}` : null
        );
      })
      .catch(() => undefined);
    getStatus()
      .then((r) => alive && setOnline(r.ok ? r.online : null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const copyIp = async () => {
    try {
      await navigator.clipboard.writeText(serverIp);
      setCopied(true);
      haptic("light");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="relative pt-14 sm:pt-20">
      <div className="container">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
            >
              {facts.map((f) => (
                <span
                  key={f.label}
                  className="inline-flex items-center gap-2 text-[13px] font-medium text-faint"
                >
                  <f.icon className="h-3.5 w-3.5 shrink-0 text-magic" />
                  {f.label}
                </span>
              ))}
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="mt-6 font-display text-[2.4rem] font-bold leading-[1.08] tracking-tight text-ink sm:text-[3.4rem]"
            >
              Проходка
              <br />
              на сервер{" "}
              <span className="text-gradient whitespace-nowrap">Loki&nbsp;Ti</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.14 }}
              className="mt-5 max-w-xl text-base leading-relaxed text-body sm:text-lg"
            >
              Оплатил — и через 30 секунд ты в whitelist. Карта, СБП или
              Telegram Stars. Без переписок с админами и без DonationAlerts.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link href="/buy">
                <Button size="lg" className="px-8">
                  Купить проходку
                  <span className="border-l border-black/30 pl-2.5 font-mono text-[13px] normal-case opacity-80">
                    {formatKopecks(prices.new)}
                  </span>
                </Button>
              </Link>

              <button
                type="button"
                onClick={copyIp}
                className="inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-line px-4 font-mono text-sm text-faint transition hover:border-muted/60 hover:text-ink"
                title="Скопировать IP сервера"
              >
                <span className="text-magic">/server</span>
                <span>{serverIp}</span>
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-700" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mx-auto w-full max-w-md"
          >
            <Image
              src="/brand/hero-art.svg"
              alt="Маскот сервера Loki Ti"
              width={560}
              height={400}
              priority
              unoptimized
              className="w-full rounded-2xl border border-line"
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[13px] text-faint">
              <span>{season ?? "Загрузка сезона…"}</span>
              <span className="inline-flex items-center gap-2">
                {online !== null && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    aria-hidden
                  />
                )}
                {online !== null ? `Онлайн ${online}` : serverIp}
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
