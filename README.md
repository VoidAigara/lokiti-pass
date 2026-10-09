# Loki Ti Pass

Продажа «проходки» (доступа в whitelist) на Minecraft-сервере **Loki Ti** — замена ручным
сборам денег через DonationAlerts. Три части:

| Часть | Путь | Что делает |
|---|---|---|
| **Telegram-бот** | `apps/bot` | продажи, продления, статусы, тикеты поддержки, админ-функции |
| **API** | `apps/api` | платежи YooKassa/Stars, выдача whitelist через RCON, очередь BullMQ, админ-API |
| **Сайт** | `apps/web` | лендинг, личный кабинет, админ-панель (Next.js 14 App Router) |
| **Общее** | `packages/shared`, `packages/db` | pricing/валидация/auth + Prisma-схема |

Стек: Node.js 20 · TypeScript · Fastify 5 · Prisma 5 · PostgreSQL 16 · Redis (BullMQ) ·
grammY · Next.js 14 + Tailwind + Framer Motion · YooKassa + Telegram Stars · Docker Compose.

---

## 1. Быстрый старт (Docker Compose)

```bash
git clone <repo> lokiti-pass && cd lokiti-pass
cp .env.example .env        # заполните секреты (см. раздел 3)
docker compose up -d --build
```

Через пару минут:

- сайт: <http://localhost:3000>
- API: <http://localhost:3001/health>, <http://localhost:3001/public/season>
- админка: <http://localhost:3000/admin> (нужен Telegram-вход и `ADMIN_TG_IDS`)

Миграции БД применяются автоматически при старте контейнера `api`
(`prisma migrate deploy` в его `CMD`).

Полезные команды:

```bash
docker compose ps                # статус и health
docker compose logs -f api       # логи API
docker compose logs -f bot
docker compose down              # остановить (данные в volume pgdata сохраняются)
docker compose down -v           # остановить ВМЕСТЕ с базой (аккуратно)
```

## 2. Локальная разработка

Нужны Node.js ≥ 20, pnpm 9, запущенные PostgreSQL и Redis.

```bash
pnpm setup              # install + prisma generate + сборка packages/db
pnpm typecheck          # TS по всем пакетам
pnpm test               # vitest (shared + api)
pnpm build              # сборка всех пакетов и приложений

pnpm dev:api            # http://localhost:3001
pnpm dev:web            # http://localhost:3000
pnpm dev:bot            # поллинг Telegram
```

Скрипты БД: `pnpm db:migrate` (dev), `pnpm db:deploy` (prod), `pnpm db:studio`.

## 3. Конфигурация (`.env`)

Полный список с комментариями — `.env.example`. Ключевое:

| Переменная | Зачем |
|---|---|
| `BOT_TOKEN` | токен от @BotFather. **Если он светился в чате — перевыпустите через `/revoke`** |
| `ADMIN_TG_IDS` | Telegram ID админов через запятую (доступ в `/admin`, команды `/admin`) |
| `JWT_SECRET` (≥32 симв.), `INTERNAL_TOKEN` (≥32 симв.) | сессии сайта и серверные вызовы бот → API |
| `TRUSTED_PROXIES` | доверенные reverse-proxy (пусто = XFF игнорируется) |
| `POSTGRES_*`, `DATABASE_URL` | база |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | ключи ЮKassa из личного кабинета |
| `YOOKASSA_WEBHOOK_IPS` | allowlist IP вебхуков ЮKassa (пусто = IP не проверяется, но тело вебхука всё равно сверяется с API ЮKassa) |
| `MC_HOST`, `MC_RCON_PORT`, `MC_RCON_PASSWORD` | выдача/отзыв whitelist через RCON |
| `MC_SERVER_IP` | адрес сервера, показываемый игрокам (`play.lokiti.ru`) |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_MC_IP` | брендировка сайта — **зашиваются в образ при сборке web** |

Секреты никогда не попадают в образ web: фронт ходит в API, а валидацию initData
делает сервер по `BOT_TOKEN`.

## 4. Telegram-бот

1. [@BotFather](https://t.me/BotFather) → `/newbot` → токен в `.env`.
2. `/revoke`, если токен ранее куда-то утекал.
3. `ADMIN_TG_IDS` — ваши и модераторов (узнать свой ID: [@userinfobot](https://t.me/userinfobot)).
4. BotFather → `/setmenubutton` → выберите бота → URL кнопки меню: `https://pass.lokiti.ru`
   (после настройки домена, раздел 6).
5. Перезапуск: `docker compose restart bot`.

## 5. YooKassa

1. Личный кабинет → Мои приложения → создать приложение → получить `ShopId` и `Secret key`.
2. Настройки вебхуков: URL = `https://api.pass.lokiti.ru/payments/webhook`,
   событие — «Уведомление о платеже».
3. В `.env` пропишите `YOOKASSA_WEBHOOK_IPS` (актуальный список подсетей — в документации ЮKassa).
4. Чеки по 54-ФЗ: опционально `YOOKASSA_RECEIPT=true` + `YOOKASSA_VAT_CODE` + `YOOKASSA_TAXATION_SYSTEM`
   (нужен договор с ОФД/оператором фискальных данных). Без них продажи работают,
   но юрлицо/самозанятость должно отчитываться самостоятельно.
5. Безопасность: вебхук ЮKassa не подписывается — сервер дополнительно сверяет платёж
   запросом `GET /v3/payments/:id` на их API и ограничивает IP.

## 6. Деплой на VPS (Ubuntu 22.04/24.04)

### 6.1 Сервер и DNS

- VPS: 2 vCPU / 4 GB RAM минимум, Ubuntu 24.04.
- DNS-записи на вашем регистраторе (A-записи на IP сервера):

```
pass.example.com      A   <IP_VPS>
api.pass.example.com  A   <IP_VPS>
```

(домен подставьте свой; ниже везде `example.com`).

### 6.2 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version   # должен быть ≥ 2.20
```

### 6.3 Код и переменные

```bash
sudo mkdir -p /opt/lokiti-pass && sudo chown $USER:$USER /opt/lokiti-pass
git clone <repo> /opt/lokiti-pass && cd /opt/lokiti-pass
cp .env.example .env && nano .env    # заполните ВСЁ: токены, пароли, домены
```

В `.env` для продакшена обязательно:

```
WEB_URL=https://pass.example.com
NEXT_PUBLIC_API_URL=https://api.pass.example.com
NEXT_PUBLIC_WEB_URL=https://pass.example.com
NEXT_PUBLIC_BOT_USERNAME=<ваш_бот>
DATABASE_URL=postgresql://loki:<ПАРОЛЬ>@postgres:5432/lokipass?schema=public
POSTGRES_PASSWORD=<ПАРОЛЬ>
```

> `NEXT_PUBLIC_*` попадают в сборку web — при смене значений нужен
> `docker compose build web`.

### 6.4 Сборка и запуск

```bash
docker compose up -d --build
docker compose ps        # api должен стать healthy
```

### 6.5 nginx (reverse proxy)

```bash
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/lokiti-pass >/dev/null <<'NGINX'
server {
    listen 80;
    server_name pass.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server {
    listen 80;
    server_name api.pass.example.com;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/lokiti-pass /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6.6 HTTPS (certbot)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pass.example.com -d api.pass.example.com
# сертификат обновляется автоматически: systemctl status certbot.timer
```

### 6.7 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
# 3000/3001 слушаются только на 127.0.0.1 — наружу не выходят
```

### 6.8 Проверка

- `https://pass.example.com` → лендинг, `/buy`, `/profile`, `/admin`.
- `https://api.pass.example.com/public/season` → JSON.
- `https://api.pass.example.com/health` → `ok` (или `degraded`, если RCON недоступен).
- Бот отвечает `/start`.
- Тестовый платеж 1 ₽ (ЮKassa в тестовом режиме) → статус `PAID` в админке
  → ник появляется в whitelist (лог RCON виден в `/admin → whitelist-log`).

### 6.9 Обновление и бэкапы

```bash
# обновление
cd /opt/lokiti-pass && git pull
docker compose build && docker compose up -d    # миграции применит api сам

# бэкап базы (добавьте в cron)
docker compose exec -T postgres pg_dump -U loki -d lokipass | gzip > /backup/lokipass-$(date +%F).sql.gz
# восстановление
gunzip -c /backup/lokipass-2026-10-05.sql.gz | docker compose exec -T postgres psql -U loki -d lokipass
```

## 7. Перенос игроков из DonationAlerts

```bash
# экспорт из DonationAlerts → CSV (колонки: дата, сумма, сообщение, имя)
pnpm migrate:donationalerts -- --file ./da-export.csv --dry-run   # посмотреть, что будет
pnpm migrate:donationalerts -- --file ./da-export.csv --season 5
```

Скрипт идемпотентен (повторный запуск не дублирует платежи), создаёт игрока с
`status=ACTIVE`, платёж `provider=MANUAL`, запись в whitelist-log
(`note: import from DonationAlerts`) и начисляет сумму в `totalPaid`.
Строки без распознанного ника пропускаются и печатаются в отчёт.

Если в CSV есть колонка с Telegram ID — игрок сразу привяжется к своему аккаунту;
иначе создаётся служебный пользователь с отрицательным `tgId` (не путается с реальными).

## 8. Админ-панель

Сайт → `/admin` (доступ только для `ADMIN_TG_IDS`, вход через Telegram):

- **Объявить вайп** — новый сезон: старые доступы → `EXPIRED`, `whitelist remove` через RCON.
- Платежи, игроки, бан/разбан, тикеты, запросы на смену ника, рассылка.
- **Возврат** — только вручную, с причиной; пишется в `AuditLog`, платёж → `REFUNDED`,
  доступ отзывается, игрок уведомляется.

## 9. Разработка

```bash
pnpm typecheck    # обязательная проверка перед коммитом
pnpm test         # vitest: pricing, auth, валидация, settle/payments
pnpm lint         # ESLint/tsc по apps
```

Тесты платёжной логики — `apps/api/tests/settle.test.ts`
(вебхук → выдача → продление → возврат, идемпотентность), домена — `packages/shared/tests/`.

### E2E smoke-тест (весь путь без Minecraft и YooKassa)

```bash
docker compose up -d --build
pnpm smoke
```

`scripts/smoke.ts` поднимает локальный RCON-сервер-заглушку (`scripts/fake-rcon.ts`)
и гоняет по реальному API в Docker:

1. сезон объявлен через `/admin/seasons/wipe`;
2. вход бота по `x-internal-token` и вход игрока по подписанному `initData`
   (плюс проверка, что подделка initData отклоняется);
3. платёж 500 ₽, идемпотентный повторный `create`;
4. вебхук YooKassa → очередь BullMQ → `whitelist add` в RCON → статус `ACTIVE`;
5. повторная покупка → `409 ALREADY_ACTIVE`, `/health` → `ok`;
6. возврат админом → `REFUNDED`, `whitelist remove`, статус `EXPIRED`;
7. админская статистика/логи, ограничение доступа к `/admin/*`, страницы сайта → 200.

Без ключей `YOOKASSA_SHOP_ID/SECRET_KEY` шлюз работает в **DEMO-режиме**
(`fakeGateway`): платежи создаются локально, доступ выдаётся только по вебхуку
или вручную в админке. Лог содержит предупреждение об этом при старте API.

## 10. Важные замечания

- **Цены считаются только в одном месте** — `computeOffer()` в
  `packages/shared/src/pricing.ts` (500 ₽ новая, 200 ₽ продление).
  Не хардкодьте суммы нигде больше.
- **50-ФЗ/54-ФЗ и налоги**: проект не считает налоги и не печатает чеки по умолчанию —
  при коммерческих оборотах включите `YOOKASSA_RECEIPT` или отчитывайтесь сами.
- **Секреты** живут только в `.env`; `.env` и `*.local` в `.gitignore`.
  Токен бота и ключи ЮKassa не должны попадать в git и в логи.
- **Вайп**: делайте только через «Объявить вайп» — ручное удаление строк в БД ломает историю платежей.
- Кириллица в репозитории: правьте файлы редактором/Write, не PowerShell `Set-Content`
  (он портит кодировку в cp1251 и добавляет BOM).

## 11. Траблшутинг

| Симптом | Что смотреть |
|---|---|
| `api` unhealthy | `docker compose logs api` — миграции, `DATABASE_URL` |
| платёж оплачен, а whitelist не выдался | `docker compose logs api` → очередь BullMQ; `/admin → whitelist-log`; пароль RCON в `.env` |
| вебхук ЮKassa не приходит | URL `/payments/webhook`, `YOOKASSA_WEBHOOK_IPS`, `docker compose logs api` |
| сайт не видит API | `NEXT_PUBLIC_API_URL` при **сборке** web: `docker compose build web` |
| «Invalid initData» на сайте | разные `BOT_TOKEN` в api и боте |
| `health` отдаёт `degraded` | RCON/Майнкрафт недоступен — сам сайт и платежи работают |
