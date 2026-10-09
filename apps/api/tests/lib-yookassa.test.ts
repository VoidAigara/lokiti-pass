import { describe, expect, it, vi } from "vitest";

// Настраиваемые креды YooKassa (в vitest.config их нет — module default «не настроена»).
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      YOOKASSA_SHOP_ID: "shop_test",
      YOOKASSA_SECRET_KEY: "secret_test",
      YOOKASSA_RECEIPT: true,
      YOOKASSA_VAT_CODE: 1,
      YOOKASSA_TAXATION_SYSTEM: 1,
      YOOKASSA_WEBHOOK_IPS: "127.0.0.1, 10.0.0.0/8",
    },
  };
});

import {
  createYkPayment,
  getYkPayment,
  ipMatches,
  isYooKassaConfigured,
  isYooKassaSourceIp,
  refundYkPayment,
  YooKassaError,
} from "../src/lib/yookassa.js";

interface YkCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function stubFetch(
  responder: (call: YkCall) => { status: number; body: unknown }
): YkCall[] {
  const calls: YkCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call: YkCall = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      calls.push(call);
      const out = responder(call);
      return {
        ok: out.status >= 200 && out.status < 300,
        status: out.status,
        text: async () => JSON.stringify(out.body),
      } as Response;
    })
  );
  return calls;
}

describe("yookassa: конфигурация и конвертация", () => {
  it("isYooKassaConfigured=true с заданными кредами", () => {
    expect(isYooKassaConfigured()).toBe(true);
  });

  it("createYkPayment: сумма копейки→рубли, capture, чек 54-ФЗ, Idempotence-Key", async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: { id: "yk_1", status: "pending", amount: { value: "5.00", currency: "RUB" }, created_at: "2026-01-01T00:00:00Z" },
    }));
    const payment = await createYkPayment({
      amount: 500,
      description: "Проходка",
      returnUrl: "https://pass.example/done",
      metadata: { paymentId: "pay_1" },
      idempotenceKey: "idem_1",
    });

    expect(payment.id).toBe("yk_1");
    const call = calls[0];
    expect(call.url).toBe("https://api.yookassa.ru/v3/payments");
    expect(call.method).toBe("POST");
    const expectedAuth = `Basic ${Buffer.from("shop_test:secret_test", "utf8").toString("base64")}`;
    expect(call.headers.authorization).toBe(expectedAuth);
    expect(call.headers["Idempotence-Key"]).toBe("idem_1");

    expect(call.body).toMatchObject({
      amount: { value: "5.00", currency: "RUB" },
      capture: true,
      description: "Проходка",
      metadata: { paymentId: "pay_1" },
      confirmation: { type: "redirect", return_url: "https://pass.example/done" },
    });
    const receipt = call.body!.receipt as { items: Array<Record<string, unknown>>; tax_system_code: number };
    expect(receipt.tax_system_code).toBe(1);
    expect(receipt.items[0]).toMatchObject({
      description: "Проходка",
      quantity: "1.00",
      vat_code: 1,
      payment_subject: "service",
      payment_mode: "full_payment",
    });
  });

  it("getYkPayment: id экранируется в пути", async () => {
    const calls = stubFetch(() => ({ status: 200, body: { id: "a/b", status: "succeeded" } }));
    await getYkPayment("a/b");
    expect(calls[0].url).toBe("https://api.yookassa.ru/v3/payments/a%2Fb");
    expect(calls[0].method).toBe("GET");
  });

  it("refundYkPayment: без amount — только payment_id; с amount — сумма в рублях", async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: { id: "rf_1", status: "succeeded", amount: { value: "5.00", currency: "RUB" }, created_at: "x" },
    }));
    await refundYkPayment({ paymentId: "pay_1", idempotenceKey: "idem_r" });
    expect(calls[0].body).toEqual({ payment_id: "pay_1" });
    expect(calls[0].headers["Idempotence-Key"]).toBe("idem_r");

    await refundYkPayment({ paymentId: "pay_1", amount: 250, idempotenceKey: "idem_r2" });
    expect(calls[1].body).toEqual({
      payment_id: "pay_1",
      amount: { value: "2.50", currency: "RUB" },
    });
  });

  it("HTTP-ошибка → YooKassaError со status и code", async () => {
    stubFetch(() => ({
      status: 400,
      body: { code: "invalid_request", description: "Сумма меньше минимума" },
    }));
    const err = await createYkPayment({
      amount: 1,
      description: "x",
      returnUrl: "https://x",
      idempotenceKey: "k",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YooKassaError);
    const yk = err as YooKassaError;
    expect(yk.status).toBe(400);
    expect(yk.code).toBe("invalid_request");
    expect(yk.message).toBe("Сумма меньше минимума");
    expect(yk.name).toBe("YooKassaError");
  });
});

describe("yookassa: IP вебхуков (CIDR)", () => {
  it("ipMatches: точное совпадение, ::ffff: префикс", () => {
    expect(ipMatches("127.0.0.1", "127.0.0.1")).toBe(true);
    expect(ipMatches("::ffff:127.0.0.1", "127.0.0.1")).toBe(true);
    expect(ipMatches("127.0.0.2", "127.0.0.1")).toBe(false);
  });

  it("ipMatches: CIDR /8, /32, мусор → false", () => {
    expect(ipMatches("10.255.1.1", "10.0.0.0/8")).toBe(true);
    expect(ipMatches("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipMatches("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(ipMatches("10.0.0.1", "10.0.0.1/99")).toBe(false);
    expect(ipMatches("not-an-ip", "10.0.0.0/8")).toBe(false);
  });

  it("isYooKassaSourceIp по списку из конфига", () => {
    expect(isYooKassaSourceIp("127.0.0.1")).toBe(true);
    expect(isYooKassaSourceIp("10.1.2.3")).toBe(true);
    expect(isYooKassaSourceIp("8.8.8.8")).toBe(false);
  });
});
