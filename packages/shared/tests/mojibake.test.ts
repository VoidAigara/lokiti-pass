import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Регресс-тест на «кракозябры»: UTF-8 текст, однажды прочитанный как
 * windows-1251 и записанный обратно в UTF-8 (двойное кодирование).
 * Мусор выглядит как каша из кириллицы с латинскими похожими буквами
 * и обрывков эмодзи.
 *
 * Сигнатура: буквы кириллического блока, которых нет в русском алфавите
 * (список — в самом regex ниже через \u-эскейпы), они в кодовой базе
 * не встречаются никогда. Плюс символы замены U+FFFD.
 *
 * Сами паттерны записаны через \u-эскейпы, чтобы тест не пал сам на себе.
 */
const MOJIBAKE_SIGNATURE =
  /[\u0402\u0452\u0403\u0453\u0406\u0456\u0407\u0457\u0408\u0458\u0409\u0459\u040A\u045A\u040B\u045B\u040C\u045C\u040E\u045E\u040F\u045F\uFFFD]/;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCAN_DIRS = ["apps", "packages", "scripts"];
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|json|yml|yaml|md|css|prisma|html)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".git",
  "coverage",
  "migrations",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (SCAN_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("исходники не содержат кракозябры (двойное кодирование)", () => {
  const rootFiles = readdirSync(ROOT)
    .filter((f) => SCAN_EXT.test(f))
    .map((f) => join(ROOT, f));
  const files = [
    ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...rootFiles,
    join(ROOT, "README.md"),
    join(ROOT, "docker-compose.yml"),
  ].filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });

  it("найдены файлы для сканирования", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("ни один файл не содержит мусора", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const match = content.match(MOJIBAKE_SIGNATURE);
      if (match) {
        const idx = content.indexOf(match[0]);
        const line = content.slice(0, idx).split("\n").length;
        offenders.push(
          `${file.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/") + "/", "")}:${line} -> "${match[0]}"`
        );
      }
    }
    expect(
      offenders,
      "Найдены файлы с двойным кодировкой UTF-8/cp1251:\n" + offenders.join("\n")
    ).toEqual([]);
  });
});
