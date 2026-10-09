/**
 * Миграция игроков из DonationAlerts.
 *
 * Использование:
 *   pnpm migrate:donationalerts -- --file ./da-export.csv [--season 5] [--dry-run]
 *
 * CSV: первый ряд — заголовки. Поддерживаются и русские, и английские имена
 * колонок (DonationAlerts меняет выгрузку). Обязательна колонка с суммой
 * и колонка с сообщением/комментарием (в нём обычно есть ник).
 *
 *   Дата / created_at / date
 *   Сумма / amount / value
 *   Сообщение / message / comment / текст
 *   Имя / name / from / donor
 *   Telegram ID / tg_id / telegram_id   (необязательно)
 *
 * Скрипт идемпотентен: повторный запуск не создаёт дублей платежей
 * (idempotencyKey = "da:<sha256 колонок ряда>").
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { MC_NICK_REGEX } from "@loki/shared";

const prisma = new PrismaClient();

interface Args {
  file: string;
  season?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: "", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i] ?? "";
    else if (a === "--season") args.season = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
  }
  if (!args.file) {
    console.error(
      "Использование: pnpm migrate:donationalerts -- --file ./da-export.csv [--season 5] [--dry-run]"
    );
    process.exit(1);
  }
  return args;
}

/** Простой CSV-парсер с кавычками и выбором разделителя. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const firstLine = clean.split("\n")[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
    ? ";"
    : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim());

  return body.map((cells) => {
    const rec: Record<string, string> = {};
    keys.forEach((k, idx) => {
      rec[k] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
}

const ALIASES = {
  date: ["дата", "date", "created_at", "createdat", "время", "time"],
  amount: ["сумма", "amount", "value", "сумма (руб.)", "rub"],
  message: ["сообщение", "message", "comment", "комментарий", "текст", "text"],
  name: ["имя", "name", "from", "донор", "donor", "username"],
  tgId: ["tg_id", "telegram_id", "telegram id", "id tg", "user id"],
} as const;

function pick(rec: Record<string, string>, keys: readonly string[]): string {
  for (const key of Object.keys(rec)) {
    const norm = key.toLowerCase().trim();
    if (keys.includes(norm)) return rec[key];
  }
  return "";
}

/** "500" | "500,00" | "500.00 RUB" | "50 000 ₽" → копейки. */
export function toKopecks(raw: string): number {
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function extractNick(text: string): string | null {
  if (!text) return null;
  // ищем валидный ник в свободном тексте (по словам 3–16 символов)
  const words = text.split(/[\s,;|()[\]{}<>:]+/);
  for (const w of words) {
    const m = w.match(MC_NICK_REGEX);
    if (m && m[0].length >= 3 && m[0].length <= 16) return m[0];
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const csv = readFileSync(resolve(args.file), "utf8");
  const rows = parseCsv(csv);

  const season = args.season
    ? await prisma.season.findFirst({ where: { number: args.season } })
    : await prisma.season.findFirst({ where: { isActive: true } });

  if (!season) {
    console.error(
      "Сезон не найден. Укажите --season <номер> или сначала объявите сезон в админке."
    );
    process.exit(1);
  }

  console.log(
    `Файл: ${args.file} · строк: ${rows.length} · сезон: #${season.number} ${season.name}` +
      (args.dryRun ? " · DRY-RUN" : "")
  );

  let imported = 0;
  let skipped = 0;
  const failed = 0;
  let syntheticTgId = -9_000_000_000;

  for (const [index, row] of rows.entries()) {
    const amount = toKopecks(pick(row, ALIASES.amount));
    const dateRaw = pick(row, ALIASES.date);
    const message = pick(row, ALIASES.message);
    const donor = pick(row, ALIASES.name);
    const tgRaw = pick(row, ALIASES.tgId);

    const nick = extractNick(message) ?? extractNick(donor);
    if (!nick) {
      console.log(`  [${index + 1}] пропущен: не найден ник («${message.slice(0, 60)}»)`);
      skipped += 1;
      continue;
    }
    if (amount <= 0) {
      console.log(`  [${index + 1}] пропущен: не распознана сумма («${pick(row, ALIASES.amount)}»)`);
      skipped += 1;
      continue;
    }

    const idempotencyKey = `da:${createHash("sha256")
      .update(JSON.stringify(row))
      .digest("hex")
      .slice(0, 32)}`;

    const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      skipped += 1;
      continue;
    }

    const paidAt = dateRaw ? new Date(dateRaw) : new Date();
    const tgId = /^\d{1,20}$/.test(tgRaw) ? BigInt(tgRaw) : BigInt(syntheticTgId--);

    if (args.dryRun) {
      console.log(`  [${index + 1}] ${nick} · ${amount / 100} ₽ · ${paidAt.toISOString()}`);
      imported += 1;
      continue;
    }

    const user = await prisma.user.upsert({
      where: { tgId },
      create: {
        tgId,
        tgUsername: null,
        firstName: donor || null,
        lastName: null,
        isAdmin: false,
      },
      update: {},
    });

    const player = await prisma.player.upsert({
      where: { mcNickLower: nick.toLowerCase() },
      create: {
        userId: user.id,
        mcNick: nick,
        mcNickLower: nick.toLowerCase(),
        status: "ACTIVE",
        currentSeasonId: season.id,
      },
      update: {},
    });

    await prisma.payment.create({
      data: {
        userId: user.id,
        playerId: player.id,
        seasonId: season.id,
        amount,
        currency: "RUB",
        type: "NEW",
        provider: "MANUAL",
        description: "Перенос из DonationAlerts",
        idempotencyKey,
        status: "PAID",
        paidAt,
        createdAt: paidAt,
      },
    });

    await prisma.playerSeason.upsert({
      where: { playerId_seasonId: { playerId: player.id, seasonId: season.id } },
      create: {
        playerId: player.id,
        seasonId: season.id,
        status: "ACTIVE",
        grantedAt: paidAt,
        paidAmount: amount,
      },
      update: { status: "ACTIVE", revokedAt: null, paidAmount: amount },
    });

    await prisma.player.update({
      where: { id: player.id },
      data: {
        status: "ACTIVE",
        currentSeasonId: season.id,
        totalPaid: { increment: amount },
        firstPaidAt: player.firstPaidAt ?? paidAt,
        lastPaidAt: paidAt,
      },
    });

    await prisma.whitelistLog.create({
      data: {
        mcNick: nick,
        mcNickLower: nick.toLowerCase(),
        action: "ADD",
        actor: "ADMIN",
        seasonId: season.id,
        note: "import from DonationAlerts",
      },
    });

    imported += 1;
    console.log(`  [${index + 1}] ${nick} · ${amount / 100} ₽ — импортирован`);
  }

  console.log(
    `\nГотово. Импортировано: ${imported} · пропущено: ${skipped} · ошибок: ${failed}` +
      (args.dryRun ? " (dry-run, ничего не записано)" : "")
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
