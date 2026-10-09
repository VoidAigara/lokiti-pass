const standalone = process.env.NEXT_OUTPUT === "standalone";

// Origin API для CSP connect-src (сюда уходят запросы из lib/api.ts).
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
      .origin;
  } catch {
    return "http://localhost:3001";
  }
})();

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' обязателен для inline-скриптов App Router (flight-data)
  // и инлайн-скрипта темы в layout; внешние источники скриптов ограничены
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
  // сайт сам может открывать ссылки Telegram; сам он — только в Telegram
  "frame-src 'self' https://web.telegram.org",
  // Mini App — iframe внутри Telegram Web: фреймить может только он
  "frame-ancestors 'self' https://web.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // standalone включается только при сборке в Docker (на Windows локально
  // падает на symlink-привилегиях), см. apps/web/Dockerfile
  ...(standalone ? { output: "standalone" } : {}),
  experimental: standalone
    ? {
        // корень монорепо — иначе standalone-сборка не подтянет packages/shared
        outputFileTracingRoot: new URL("../..", import.meta.url).pathname.replace(
          /^\/([A-Za-z]:)/,
          "$1"
        ),
      }
    : {},
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // X-Frame-Options НЕ ставим: он бы запретил iframe Telegram
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_BOT_USERNAME: process.env.NEXT_PUBLIC_BOT_USERNAME ?? "",
    NEXT_PUBLIC_MC_IP: process.env.NEXT_PUBLIC_MC_IP ?? "play.lokiti.ru",
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "",
    NEXT_PUBLIC_UMAMI_HOST: process.env.NEXT_PUBLIC_UMAMI_HOST ?? "",
  },
};

export default nextConfig;
