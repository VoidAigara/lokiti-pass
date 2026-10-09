// Публичный фронтенд-мультиплексор (zero-dep, только node:http).
//
// Один порт обслуживает и сайт (Next, 3000), и API (Fastify, 3001):
//   /api/*  → http://127.0.0.1:3001/*   (преффикс /api срезается)
//   всё остальное → http://127.0.0.1:3000/*
//
// Браузер ходит в /api/* того же origin — поэтому NEXT_PUBLIC_API_URL=/api
// и одному URL хватает на всё (см. apps/web/lib/api.ts).
// Публикуется наружу через Tailscale Funnel (см. README-раздел "Публичный доступ")
// или любой reverse-proxy/cloudflared.
//
// Запуск:  node scripts/public-proxy.mjs
// Порт:    PUBLIC_PROXY_PORT (дефолт 8080)

import http from "node:http";

const WEB = { host: "127.0.0.1", port: 3000 };
const API = { host: "127.0.0.1", port: 3001 };
const PORT = Number(process.env.PUBLIC_PROXY_PORT ?? 8080);

function proxyTo(target, req, res, path) {
  const upstream = http.request(
    { ...target, path, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "BAD_GATEWAY" }));
  });
  req.pipe(upstream);
}

http
  .createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/api" || url.startsWith("/api/")) {
      const stripped = url.replace(/^\/api/, "") || "/";
      proxyTo(API, req, res, stripped);
      return;
    }
    proxyTo(WEB, req, res, url);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`public-proxy: web=${WEB.port} api=${API.port} listen :${PORT}`);
  });
