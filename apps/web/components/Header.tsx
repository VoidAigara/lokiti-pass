"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Moon, ShieldCheck, Sun, User, X } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { deepLink } from "@/lib/telegram";

const nav = [
  { href: "/#how", label: "Как это работает" },
  { href: "/#pricing", label: "Цена" },
  { href: "/#faq", label: "Вопросы" },
];

export function Logo({ light }: { light?: boolean }) {
  return (
    <span className="group inline-flex items-center gap-2.5">
      <Image
        src="/brand/avatar-art.svg"
        alt=""
        width={36}
        height={36}
        unoptimized
        className="h-8 w-8 shrink-0 rounded-lg border border-line"
      />
      <span
        className={
          light
            ? "font-display text-[15px] font-bold uppercase tracking-wider text-[#F5F2EC]"
            : "font-display text-[15px] font-bold uppercase tracking-wider text-ink"
        }
      >
        Loki&nbsp;Ti
      </span>
    </span>
  );
}

const THEME_KEY = "loki-theme";

function getTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    setTheme(getTheme());
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-fade");
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => root.classList.remove("theme-fade"), 320);
    setTheme(next);
  };

  return (
    <button
      type="button"
      aria-label="Переключить тему"
      title={theme === "dark" ? "Тема: ночь" : "Тема: день"}
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line text-faint transition hover:border-muted/60 hover:text-ink"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

export function Header() {
  const pathname = usePathname();
  const { status, me } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const authed = status === "ready" && Boolean(me);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-4 sm:h-[68px]">
        <Link href="/" aria-label="На главную" className="shrink-0">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {nav.map((n) => {
            const active = n.href === pathname;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`text-[13px] font-medium transition ${
                  active ? "text-ink" : "text-faint hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />

          {authed ? (
            <Link href="/profile">
              <Button variant="outline" size="sm" className="h-9">
                {me?.user?.isAdmin ? (
                  <ShieldCheck className="h-4 w-4 text-magic" />
                ) : (
                  <User className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">
                  {me?.player?.mcNick ?? me?.user?.firstName ?? "Профиль"}
                </span>
              </Button>
            </Link>
          ) : null}

          <Link href="/buy" className="hidden sm:block">
            <Button size="sm" className="h-9 px-5">
              Купить проходку
            </Button>
          </Link>

          <button
            type="button"
            aria-label="Меню"
            onClick={() => setOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line text-faint transition hover:text-ink lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-b border-line bg-paper px-4 py-2 lg:hidden">
          <nav className="flex flex-col">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="border-b border-line py-3 text-sm font-medium text-body transition hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
            <Link
              href="/rules"
              className="border-b border-line py-3 text-sm font-medium text-body transition hover:text-ink"
            >
              Правила
            </Link>
            <div className="flex gap-2.5 py-3">
              <Link href="/buy" className="btn-primary flex-1 px-3 py-2.5 text-center text-xs">
                Купить проходку
              </Link>
              <a
                href={deepLink("/start")}
                className="btn-ghost flex-1 px-3 py-2.5 text-center text-xs"
                target="_blank"
                rel="noreferrer"
              >
                Открыть бота
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
