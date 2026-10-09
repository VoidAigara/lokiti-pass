/**
 * E2E smoke: прогоняет весь путь «во время» через реальный API в Docker:
 *   сезон → вход (bot-session + WebApp initData) → создание платежа
 *   → вебхук YooKassa → очередь → RCON whitelist → доступ ACTIVE
 *   → повторная покупка (409) → возврат админом → EXPIRED
 *
 * Вместо Minecraft поднимается локальный RCON-сервер-заглушка (scripts/fake-rcon.ts),
 * вместо YooKassa — demo-шлюз (см. adapters/wiring.ts) и поддельный вебхук.
 *
 * Запуск:
 *   docker compose up -d --build   # затем
 *   pnpm smoke
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startFakeRcon, type FakeRcon } from "./fake-rcon.js";

const API = process.env.SMOKE_API_URL ?? "http://127.0.0.1:3001";
const WEB = process.env.SMOKE_WEB_URL ?? "http://127.0.0.1:3000";

interface Cfg {
  BOT_TOKEN: string;
  INTERNAL_TOKEN: string;
  ADMIN_TG_IDS: string;
  MC_RCON_PORT?: string;
  MC_RCON_PASSWORD?: string;
}

function loadCfg(): Cfg {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8").replace(/^\uFEFF/, "");
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m?.[1]) map.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  const required = ["BOT_TOKEN", "INTERNAL_TOKEN", "ADMIN_TG_IDS"] as const;
  for (const key of required) {
    if (!map.get(key)) throw new Error(`.env: не заполнен ${key}`);
  }
  return Object.fromEntries(map) as unknown as Cfg;
}

interface Res {
  status: number;
  json: any;
  text: string;
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; internal?: string; body?: unknown } = {}
): Promise<Res> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.internal) headers["x-internal-token"] = opts.internal;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // не JSON — остаётся null
  }
  return { status: res.status, json, text };
}

async function web(path: string): Promise<number> {
  try {
    const res = await fetch(`${WEB}${path}`);
    return res.status;
  } catch {
    return 0;
  }
}

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

/** Подпись initData так же, как её делает Telegram WebApp. */
function signInitData(botToken: string, fields: Record<string, string>): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  what: string,
  probe: () => Promise<boolean>,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(`не дождались: ${what}${lastErr ? ` (${lastErr})` : ""}`);
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name} … `);
  try {
    await fn();
    passed += 1;
    console.log("ok");
  } catch (err) {
    console.log("FAIL");
    throw new Error(
      `${name}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

async function main(): Promise<void> {
  const cfg = loadCfg();
  const adminTgId = cfg.ADMIN_TG_IDS.split(",")[0]?.trim();
  ok(adminTgId && /^\d+$/.test(adminTgId), ".env: ADMIN_TG_IDS пуст");

  // каждый запуск работает свежим игроком — smoke можно гонять повторно
  const runId = String(Date.now()).slice(-6);
  const userTgId = `777${runId}`;
  const nick = `Smoke${runId}`;

  const rconPassword = cfg.MC_RCON_PASSWORD || "smoke-rcon";
  const rcon: FakeRcon = await startFakeRcon({
    port: Number(cfg.MC_RCON_PORT ?? 25575),
    password: rconPassword,
  });
  console.log(`fake RCON слушает :${rcon.port}`);

  try {
    await step("API отвечает", async () => {
      await waitFor("API /public/season", async () => {
        const r = await call("GET", "/public/season");
        return r.status === 200;
      });
    });

    await step("bot-session требует внутренний токен", async () => {
      const r = await call("POST", "/auth/bot-session", { body: { tgId: adminTgId } });
      eq(r.status, 403, "статус без x-internal-token");
    });

    let adminToken = "";
    await step("вход бота от имени админа (bot-session)", async () => {
      const r = await call("POST", "/auth/bot-session", {
        internal: cfg.INTERNAL_TOKEN,
        body: { tgId: adminTgId, firstName: "Smoke", tgUsername: "smoke_admin" },
      });
      eq(r.status, 200, "статус");
      ok(r.json?.token, "нет token");
      ok(r.json?.user?.isAdmin, "пользователь не админ");
      adminToken = r.json.token;
    });

    let seasonId = "";
    await step("объявить сезон из админки", async () => {      const r = await call("POST", "/admin/seasons/wipe", {
        token: adminToken,
        body: { name: "Smoke Season", priceNew: 50_000, priceRenew: 20_000 },
      });
      eq(r.status, 200, "статус");
      seasonId = r.json?.season?.id;
      ok(seasonId, "нет id сезона");
    });

    let userToken = "";
    const initData = signInitData(cfg.BOT_TOKEN, {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAFsmoke",
      user: JSON.stringify({ id: Number(userTgId), first_name: "Smoke", username: "smoke_user" }),
    });

    await step("вход через Telegram WebApp initData", async () => {
      const bad = await call("POST", "/auth/webapp", { body: { initData: "user=x&hash=bad" } });
      eq(bad.status, 401, "подделка initData должна быть отвергнута");

      const r = await call("POST", "/auth/webapp", { body: { initData } });
      eq(r.status, 200, "статус");
      ok(r.json?.token, "нет token");
      eq(r.json?.user?.isAdmin, false, "игрок не должен быть админом");
      userToken = r.json.token;
    });

    await step("/me у нового игрока: оффер NEW 500 ₽", async () => {
      const r = await call("GET", "/me", { token: userToken });
      eq(r.status, 200, "статус");
      eq(r.json?.player, null, "игрока быть не должно");
      eq(r.json?.offer?.kind, "NEW", "offer.kind");
      eq(r.json?.offer?.amount, 50_000, "offer.amount");
    });

    let paymentId = "";
    await step("создание платежа 500 ₽", async () => {
      const r = await call("POST", "/payments/create", {
        token: userToken,
        body: { mcNick: nick },
      });
      eq(r.status, 200, "статус");
      eq(r.json?.offer?.kind, "NEW", "offer.kind");
      eq(r.json?.offer?.amount, 50_000, "offer.amount");
      ok(r.json?.confirmationUrl, "нет confirmationUrl");
      paymentId = r.json.paymentId;
      ok(paymentId, "нет paymentId");
    });

    await step("повторный вызов create идемпотентен", async () => {
      const r = await call("POST", "/payments/create", { token: userToken, body: {} });
      eq(r.status, 200, "статус");
      eq(r.json?.reused, true, "reused");
      eq(r.json?.paymentId, paymentId, "paymentId должен совпасть");
    });

    await step("вебхук YooKassa подтверждает платёж", async () => {
      const r = await call("POST", "/payments/webhook", {
        body: {
          type: "notification",
          event: "payment.succeeded",
          object: {
            id: `yp_smoke_${runId}`,
            status: "succeeded",
            paid: true,
            amount: { value: "500.00", currency: "RUB" },
            metadata: { paymentId },
          },
        },
      });
      eq(r.status, 200, "статус");
      eq(r.json?.ok, true, "ok");
    });

    await step("очередь → RCON → доступ ACTIVE", async () => {
      await waitFor("статус ACTIVE", async () => {
        const r = await call("GET", "/me", { token: userToken });
        if (r.status === 429) return false;
        return r.json?.player?.status === "ACTIVE";
      });
      ok(
        rcon.commands.includes(`whitelist add ${nick}`),
        `RCON не получил команду (получено: ${JSON.stringify(rcon.commands)})`
      );
      const me = await call("GET", "/me", { token: userToken });
      eq(me.json?.player?.totalPaid, 50_000, "totalPaid");
      eq(me.json?.offer?.kind, "ALREADY_ACTIVE", "offer после выдачи");
    });

    await step("повторная покупка при активном доступе → 409", async () => {
      const r = await call("POST", "/payments/create", { token: userToken, body: {} });
      eq(r.status, 409, "статус");
      eq(r.json?.error, "ALREADY_ACTIVE", "код ошибки");
    });

    await step("публичный сезон отдаёт цены", async () => {
      const r = await call("GET", "/public/season");
      eq(r.status, 200, "статус");
      ok(r.json?.season, "сезон не создан");
      eq(r.json?.prices?.new, 50_000, "цена новой");
      eq(r.json?.prices?.renew, 20_000, "цена продления");
      eq(r.json?.season?.id, seasonId, "id сезона");
    });

    await step("/health — ok (redis + rcon)", async () => {
      const r = await call("GET", "/health");
      eq(r.status, 200, "статус");
      eq(r.json?.status, "ok", "status");
    });

    await step("возврат админом → REFUNDED", async () => {
      const r = await call("POST", `/admin/payments/${paymentId}/refund`, {
        token: adminToken,
        body: { reason: "Smoke test refund" },
      });
      eq(r.status, 200, "статус");
      eq(r.json?.payment?.status, "REFUNDED", "статус платежа");
    });

    await step("после возврата доступ EXPIRED и whitelist снят", async () => {
      await waitFor("статус EXPIRED", async () => {
        const r = await call("GET", "/me", { token: userToken });
        if (r.status === 429) return false;
        return r.json?.player?.status === "EXPIRED";
      });
      ok(
        rcon.commands.includes(`whitelist remove ${nick}`),
        `RCON не снял ник (получено: ${JSON.stringify(rcon.commands)})`
      );
    });

    await step("админская статистика и логи", async () => {
      const stats = await call("GET", "/admin/stats", { token: adminToken });
      eq(stats.status, 200, "/admin/stats");
      ok(stats.json?.totals, "нет totals");

      const payments = await call("GET", "/admin/payments?status=REFUNDED", {
        token: adminToken,
      });
      eq(payments.status, 200, "/admin/payments");
      ok(
        payments.json?.payments?.some((p: any) => p.id === paymentId),
        "возврат не виден в списке"
      );

      const wl = await call("GET", "/admin/whitelist-log", { token: adminToken });
      eq(wl.status, 200, "/admin/whitelist-log");
      const actions = (wl.json?.log ?? wl.json?.items ?? wl.json?.whitelistLog ?? []).map(
        (l: any) => l.action
      );
      ok(actions.includes("ADD"), "нет ADD в whitelist-log");
      ok(actions.includes("REMOVE"), "нет REMOVE в whitelist-log");

      const audit = await call("GET", "/admin/audit", { token: adminToken });
      eq(audit.status, 200, "/admin/audit");
      const entries = audit.json?.audit ?? audit.json?.entries ?? audit.json?.log ?? [];
      ok(
        entries.some((e: any) => String(e.action).includes("REFUND")),
        "нет REFUND в audit-логе"
      );
    });

    await step("доступ к админке ограничен", async () => {
      eq((await call("GET", "/admin/stats")).status, 401, "без токена");
      eq((await call("GET", "/admin/stats", { token: userToken })).status, 403, "не админу");
    });

    await step("страницы сайта отвечают 200", async () => {
      for (const path of ["/", "/buy", "/profile", "/admin", "/rules", "/refund"]) {
        const status = await web(path);
        eq(status, 200, `GET ${WEB}${path}`);
      }
    });

    console.log(`\nSMOKE PASSED — шагов: ${passed}`);
    console.log(`RCON-команды: ${JSON.stringify(rcon.commands)}`);
  } finally {
    await rcon.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nSMOKE FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
