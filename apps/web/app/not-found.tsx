import Link from "next/link";
import type { Metadata } from "next";
import { House, MessageCircle } from "lucide-react";
import { deepLink } from "@/lib/links";

export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="container flex min-h-[60vh] max-w-3xl flex-col items-center justify-center py-20 text-center">
      <div className="font-display text-6xl font-bold tracking-tight text-magic">
        404
      </div>

      <span className="chip mt-8">Блок не найден</span>

      <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Такой страницы нет
      </h1>
      <p className="mt-4 max-w-md text-body">
        Возможно, ссылка устарела или в ней опечатка. Вернись на главную или
        открой бота — там всё работает.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary px-6 py-3 text-sm">
          <House className="h-4 w-4" />
          На главную
        </Link>
        <a
          href={deepLink("/start")}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost px-6 py-3 text-sm"
        >
          <MessageCircle className="h-4 w-4" />
          Открыть бота
        </a>
      </div>
    </div>
  );
}
