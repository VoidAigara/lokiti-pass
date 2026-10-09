import { describe, expect, it } from "vitest";
import { cn, daysLeft, formatDate, formatDateLong, formatKopecks, normalizeNick } from "../lib/utils.js";

describe("cn (twMerge)", () => {
  it("склеивает и дедуплицирует конфликты", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("px-2", "p-4")).toBe("p-4");
  });

  it("условия: false/undefined/null игнорируются", () => {
    expect(cn("a", { hidden: false, block: true }, undefined, null)).toBe(
      "a block"
    );
    expect(cn()).toBe("");
  });

  it("непересекающиеся классы сохраняются", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});

describe("formatKopecks (web)", () => {
  it("округление и разделитель ru-RU", () => {
    expect(formatKopecks(50_000)).toBe("500 ₽");
    expect(formatKopecks(20_000)).toBe("200 ₽");
    expect(formatKopecks(50_150)).toBe("502 ₽");
    expect(formatKopecks(0)).toBe("0 ₽");
  });
});

describe("formatDate / formatDateLong", () => {
  it("валидная дата → короткий и длинный формат", () => {
    expect(formatDate("2026-01-15T12:00:00.000Z")).toBe("15.01.2026");
    expect(formatDateLong("2026-01-15T12:00:00.000Z")).toBe("15 января 2026 г.");
  });

  it("null/undefined/мусор → тире", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("не дата")).toBe("—");
    expect(formatDateLong(null)).toBe("—");
    expect(formatDateLong("xxx")).toBe("—");
  });
});

describe("daysLeft", () => {
  it("null/мусор → null", () => {
    expect(daysLeft(null)).toBeNull();
    expect(daysLeft(undefined)).toBeNull();
    expect(daysLeft("не дата")).toBeNull();
  });

  it("округление вверх до дня", () => {
    const now = Date.now();
    expect(daysLeft(new Date(now + 90 * 60_000).toISOString())).toBe(1);
    expect(daysLeft(new Date(now + 48 * 60 * 60_000).toISOString())).toBe(2);
    expect(daysLeft(new Date(now + 25 * 60 * 60_000).toISOString())).toBe(2);
  });

  it("просрочено — отрицательные дни", () => {
    const now = Date.now();
    expect(daysLeft(new Date(now - 25 * 60 * 60_000).toISOString())).toBe(-1);
    const justExpired = daysLeft(new Date(now - 3 * 60 * 60_000).toISOString());
    expect(Math.abs(justExpired as number)).toBe(0);
  });
});

describe("normalizeNick", () => {
  it("оставляет только \\w (латиница, цифры, _)", () => {
    expect(normalizeNick("Loki_Player")).toBe("Loki_Player");
    expect(normalizeNick("Локи Player!")).toBe("Player");
    expect(normalizeNick("a b-c_d")).toBe("abc_d");
  });
});
