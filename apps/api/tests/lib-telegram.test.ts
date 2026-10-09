import { afterEach, describe, expect, it, vi } from "vitest";

// Модуль использует env из config (BOT_TOKEN/TELEGRAM_API_URL из vitest.config).
import {
  getChatMemberCount,
  notifyUser,
  refundStarPayment,
  sendMessage,
  setMyCommands,
} from "../src/lib/telegram.js";

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function stubFetch(
  responder: (call: FetchCall) => { ok: boolean; json: unknown } | Error
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call: FetchCall = {
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      };
      calls.push(call);
      const out = responder(call);
      if (out instanceof Error) throw out;
      return {
        ok: true,
        json: async () => out.json,
      } as Response;
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("telegram: sendMessage", () => {
  it("успех: POST на Bot API, HTML по умолчанию, возвращает true", async () => {
    const calls = stubFetch(() => ({ ok: true, json: { ok: true, result: { message_id: 5 } } }));
    const ok = await sendMessage(12345, "<b>привет</b>");
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/bot1:TEST_TOKEN/sendMessage");
    expect(calls[0].url.endsWith("/sendMessage")).toBe(true);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      chat_id: 12345,
      text: "<b>привет</b>",
      parse_mode: "HTML",
      disable_notification: false,
    });
    expect(calls[0].body.link_preview_options).toEqual({ is_disabled: false });
  });

  it("replyMarkup попадает в reply_markup", async () => {
    const calls = stubFetch(() => ({ ok: true, json: { ok: true, result: {} } }));
    const markup = { inline_keyboard: [[{ text: "Оплата", url: "https://t.me/x" }]] };
    await sendMessage("chat", "text", { replyMarkup: markup, linkPreview: false });
    expect(calls[0].body.reply_markup).toEqual(markup);
    expect((calls[0].body.link_preview_options as { is_disabled: boolean }).is_disabled).toBe(true);
  });

  it("Telegram ответил ok:false → false (не бросает)", async () => {
    stubFetch(() => ({
      ok: true,
      json: { ok: false, error_code: 400, description: "chat not found" },
    }));
    await expect(sendMessage(1, "x")).resolves.toBe(false);
  });

  it("сетевая ошибка fetch → false (не бросает)", async () => {
    stubFetch(() => new Error("network down"));
    await expect(sendMessage(1, "x")).resolves.toBe(false);
  });
});

describe("telegram: прочие методы", () => {
  it("getChatMemberCount: число в успехе, null в ошибке", async () => {
    stubFetch(() => ({ ok: true, json: { ok: true, result: 42 } }));
    expect(await getChatMemberCount(-100500)).toBe(42);

    stubFetch(() => new Error("boom"));
    expect(await getChatMemberCount(1)).toBeNull();
  });

  it("refundStarPayment: бросает при ok:false (возврат обязателен или ошибка)", async () => {
    stubFetch(() => ({
      ok: true,
      json: { ok: false, error_code: 400, description: "charge already refunded" },
    }));
    await expect(refundStarPayment(7, "ch_1")).rejects.toThrow(/refundStarPayment failed/);
  });

  it("setMyCommands: ошибку глотает", async () => {
    stubFetch(() => new Error("timeout"));
    await expect(setMyCommands([{ command: "buy", description: "Купить" }])).resolves.toBeUndefined();
  });

  it("notifyUser: ровно одна повторная попытка при неудаче", async () => {
    let attempt = 0;
    const calls = stubFetch(() => {
      attempt++;
      return attempt === 1 ? new Error("flap") : { ok: true, json: { ok: true, result: {} } };
    });
    await notifyUser(999n, "доступ выдан");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.chat_id).toBe(999);
  });
});
