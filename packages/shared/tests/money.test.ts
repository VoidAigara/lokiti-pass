import { describe, expect, it } from "vitest";
import { formatKopecks, parseRubToKopecks } from "../src/money.js";

describe("formatKopecks", () => {
  it("целые рубли — без дробной части", () => {
    expect(formatKopecks(50_000)).toBe("500 ₽");
    expect(formatKopecks(20_000)).toBe("200 ₽");
    expect(formatKopecks(0)).toBe("0 ₽");
    expect(formatKopecks(100)).toBe("1 ₽");
  });

  it("нецелые рубли — два знака", () => {
    expect(formatKopecks(50_50)).toBe("50.50 ₽");
    expect(formatKopecks(50_10)).toBe("50.10 ₽");
    expect(formatKopecks(5010)).toBe("50.10 ₽");
  });
});

describe("parseRubToKopecks", () => {
  it("число и строки, запятая и точка", () => {
    expect(parseRubToKopecks(500)).toBe(50_000);
    expect(parseRubToKopecks(200)).toBe(20_000);
    expect(parseRubToKopecks("500")).toBe(50_000);
    expect(parseRubToKopecks("500.5")).toBe(50_050);
    expect(parseRubToKopecks("500,5")).toBe(50_050);
    expect(parseRubToKopecks("0,07")).toBe(7);
    expect(parseRubToKopecks(0)).toBe(0);
  });

  it("округление хвоста", () => {
    expect(parseRubToKopecks("500,555")).toBe(50_056);
    expect(parseRubToKopecks(0.005)).toBe(1);
  });

  it("мусор и отрицательные — ошибка; пустая строка → 0", () => {
    expect(() => parseRubToKopecks("abc")).toThrow(/Некорректная сумма/);
    expect(parseRubToKopecks("")).toBe(0);
    expect(() => parseRubToKopecks(-1)).toThrow(/Некорректная сумма/);
    expect(() => parseRubToKopecks(NaN)).toThrow(/Некорректная сумма/);
    expect(() => parseRubToKopecks(Infinity)).toThrow(/Некорректная сумма/);
  });
});
