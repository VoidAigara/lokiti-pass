import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Unbounded } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000";
const botUsername = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "lokiti_bot";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
  title: {
    default: "Loki Ti — проходка на сервер",
    template: "%s · Loki Ti",
  },
  description:
    "Официальная проходка на Minecraft-сервер Loki Ti. Быстрая оплата, автоматическая выдача доступа, личный кабинет и поддержка.",
  keywords: [
    "Loki Ti",
    "Minecraft сервер",
    "проходка",
    "Whitelist",
    "DonationAlerts",
    "оплата",
  ],
  openGraph: {
    type: "website",
    siteName: "Loki Ti",
    title: "Loki Ti — проходка на сервер",
    description:
      "Быстрая оплата проходки: карта, СБП или Telegram Stars. Доступ выдаётся автоматически.",
    url: siteUrl,
    images: [
      {
        url: "/brand/og.png",
        width: 1200,
        height: 630,
        alt: "Loki Ti — проходка на Minecraft-сервер",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loki Ti",
    images: ["/brand/og.png"],
  },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  other: { "telegram:bot": `https://t.me/${botUsername}` },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E9E9ED" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0C" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      data-theme="dark"
      className={`${inter.variable} ${mono.variable} ${unbounded.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('loki-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}})();",
          }}
        />
      </head>
      <body className="relative min-h-screen overflow-x-hidden">
        {/* Header/Footer живут в app/(site)/layout — /app (Mini App) их не получает */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
