import { describe, expect, it } from "vitest";
import {
  BTN,
  cancelKeyboard,
  escapeHtml,
  mainKeyboard,
  texts,
} from "../src/texts.js";
import type { Offer } from "@loki/shared";

const newOffer = (over: Partial<Offer> = {}): Offer =>
  ({
    kind: "NEW",
    type: "NEW",
    amount: 50_000,
    season: {
      id: "s7",
      number: 7,
      name: "Обет Мьёльнира",
      isActive: true,
      priceNew: 50_000,
      priceRenew: 20_000,
    },
    ...over,
  }) as Offer;

describe("клавиатуры: регресс «кнопки без сайта»", () => {
  it("mainKeyboard — только текстовые кнопки, без web_app/url", () => {
    expect(mainKeyboard.resize_keyboard).toBe(true);
    expect(mainKeyboard.is_persistent).toBe(true);
    const rows = mainKeyboard.keyboard as { text: string }[][];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      for (const btn of row) {
        expect(Object.keys(btn).sort()).toEqual(["text"]);
        expect(typeof btn.text).toBe("string");
        expect(btn.text.length).toBeGreaterThan(0);
      }
    }
    const labels = rows.flat().map((b) => b.text);
    expect(labels).toEqual([
      BTN.buy,
      BTN.renew,
      BTN.profile,
      BTN.support,
      BTN.miniapp,
    ]);
    for (const label of labels) {
      expect(label).not.toMatch(/https?:/i);
      expect(label).not.toMatch(/pass\.lokiti/);
    }
  });

  it("cancelKeyboard — одна кнопка Отмена", () => {
    expect(cancelKeyboard.keyboard).toEqual([[{ text: BTN.cancel }]]);
    expect(cancelKeyboard.one_time_keyboard).toBe(true);
  });

  it("метки кнопок стабильны (совпадают с hears-обработчиками)", () => {
    expect(BTN.buy).toBe("🎟 Купить проходку");
    expect(BTN.renew).toBe("♻️ Продлить");
    expect(BTN.profile).toBe("👤 Кабинет");
    expect(BTN.support).toBe("🆘 Поддержка");
    expect(BTN.miniapp).toBe("📱 Мини-апп");
    expect(BTN.back).toBe("↩️ Назад");
    expect(BTN.cancel).toBe("✖️ Отмена");
  });
});

describe("escapeHtml", () => {
  it("экранирует & < > \" (апостроф не трогает)", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;'");
  });
});

describe("texts.start / help", () => {
  it("имя экранируется, цены на месте", () => {
    const s = texts.start(`Локи <script>`);
    expect(s).toContain("Локи &lt;script&gt;");
    expect(s).not.toContain("<script>");
    expect(s).toContain("500 ₽");
    expect(s).toContain("200 ₽");
  });

  it("без имени — «Привет!»", () => {
    expect(texts.start(null)).toContain("Привет!");
  });

  it("help перечисляет все команды", () => {
    for (const cmd of ["/start", "/buy", "/renew", "/me", "/nick", "/support", "/app", "/help"]) {
      expect(texts.help).toContain(cmd);
    }
  });
});

describe("texts.offer", () => {
  it("NO_SEASON — заглушка", () => {
    const s = texts.offer(newOffer({ kind: "NO_SEASON", reason: "Сезон не объявлен", season: null }), {
      hasNick: false,
    });
    expect(s).toContain("⏳");
    expect(s).toContain("Сезон не объявлен");
  });

  it("ALREADY_ACTIVE — доступ есть, IP сервера", () => {
    const s = texts.offer(newOffer({ kind: "ALREADY_ACTIVE" }), { hasNick: true, nick: "Loki" });
    expect(s).toContain("У тебя уже есть доступ");
    expect(s).toContain("play.lokiti.ru");
  });

  it("NEW — цена, состав, ник или предупреждение", () => {
    const withNick = texts.offer(newOffer(), { hasNick: true, nick: "Loki_Player" });
    expect(withNick).toContain("Новая проходка");
    expect(withNick).toContain("500 ₽");
    expect(withNick).toContain("Loki_Player");

    const noNick = texts.offer(newOffer(), { hasNick: false });
    expect(noNick).toContain("Сначала введём ник");
  });

  it("RENEW — заголовок продления, 200 ₽", () => {
    const s = texts.offer(newOffer({ type: "RENEW", kind: "RENEW", amount: 20_000 }), {
      hasNick: true,
      nick: "Loki",
    });
    expect(s).toContain("Продление после вайпа");
    expect(s).toContain("200 ₽");
  });
});

describe("texts.payButton / profile", () => {
  it("payButton различает NEW и RENEW", () => {
    expect(texts.payButton(50_000, "NEW")).toBe("Оплатить 500 ₽");
    expect(texts.payButton(20_000, "RENEW")).toBe("Продлить за 200 ₽");
  });

  it("profile: статусы, деньги, экранирование ника", () => {
    const base = {
      nick: "Loki",
      status: "ACTIVE",
      seasonName: "Сезон",
      seasonNumber: 7,
      totalPaid: 50_000,
      renewalCount: 2,
      lastPaidAt: "2026-01-15T12:00:00.000Z",
      offer: newOffer({ kind: "ALREADY_ACTIVE" }),
    };
    const s = texts.profile(base);
    expect(s).toContain("🟢 Доступ активен");
    expect(s).toContain("500 ₽");
    expect(s).toContain("#7");
    expect(s).toContain("play.lokiti.ru");

    const weird = texts.profile({
      ...base,
      nick: null,
      status: "WHAT",
      offer: newOffer({ kind: "RENEW", type: "RENEW", amount: 20_000 }),
    });
    expect(weird).toContain("не привязан");
    expect(weird).toContain("WHAT");
    expect(weird).toContain("200 ₽");
  });
});
