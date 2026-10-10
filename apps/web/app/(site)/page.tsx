import Link from "next/link";
import type { Metadata } from "next";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Loki Ti — проходка на сервер",
  description:
    "Купи проходку на Minecraft-сервер Loki Ti: оплата картой, СБП или Telegram Stars, автоматический доступ на whitelist.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Pricing />
      <FAQ />

      <section className="relative pb-24">
        <div className="container">
          <div className="glass p-8 sm:p-10">
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <span className="chip">Сервер ждёт</span>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  Пора зайти на сервер
                </h2>
                <p className="mt-3 text-body">
                  Оплата займёт меньше минуты, а доступ придёт автоматически.
                  Если что-то пойдёт не так — поддержка в боте.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/buy">
                  <Button size="lg">Купить проходку</Button>
                </Link>
                <Link href="/profile">
                  <Button variant="outline" size="lg">
                    Личный кабинет
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
