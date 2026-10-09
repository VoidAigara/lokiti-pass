import Link from "next/link";
import { Logo } from "@/components/Header";
import { deepLink } from "@/lib/links";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Проходка",
    links: [
      { href: "/buy", label: "Купить проходку" },
      { href: "/#pricing", label: "Цены" },
      { href: "/profile", label: "Личный кабинет" },
    ],
  },
  {
    title: "Документы",
    links: [
      { href: "/rules", label: "Правила сервера" },
      { href: "/refund", label: "Возврат средств" },
      { href: "/#faq", label: "Частые вопросы" },
    ],
  },
  {
    title: "Связь",
    links: [
      { href: deepLink("/start"), label: "Написать боту", external: true },
      { href: deepLink("/support"), label: "Поддержка", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-24 border-t border-white/10 bg-[#0A0A0C]">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo light />
            <p className="mt-4 text-sm leading-relaxed text-[#EDE7F0]/80">
              Проходка на Minecraft-сервер Loki Ti. Оплата картой, СБП или
              Telegram Stars — доступ выдаётся автоматически.
            </p>
            <p className="mt-4 text-xs text-[#EDE7F0]/40">
              Это фанатский проект. Mojang, Minecraft и Microsoft не аффилированы
              с нами.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#EDE7F0]/40">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-[#EDE7F0]/80 transition hover:text-white"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="text-sm text-[#EDE7F0]/80 transition hover:text-white"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="my-8 h-px w-full bg-white/10" />

        <div className="flex flex-col gap-2 text-xs text-[#EDE7F0]/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Loki Ti. Все права защищены.</span>
          <span>Оплата через YooKassa и Telegram Stars</span>
        </div>
      </div>
    </footer>
  );
}
