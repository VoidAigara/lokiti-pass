import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  api,
  errorMessage,
  getMe,
  loginWithTelegram,
} from "../lib/api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let calls: { url: string; init: RequestInit }[] = [];
let next: (init: RequestInit) => Response;

beforeEach(() => {
  calls = [];
  next = () => jsonResponse({ ok: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return next(init);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api(): запрос", () => {
  it("GET: url, Accept, cookie-сессия, без тела", async () => {
    const res = await api<{ ok: boolean }>("/me");
    expect(res).toEqual({ ok: true });
    const { url, init } = calls[0];
    expect(url).toBe("/api/me");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/json"
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("POST: JSON-тело и Content-Type", async () => {
    await api("/payments/create", { method: "POST", body: { type: "NEW" } });
    const { init } = calls[0];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(init.body as string)).toEqual({ type: "NEW" });
  });

  it("204 → undefined", async () => {
    next = () => new Response(null, { status: 204 });
    expect(await api("/ping")).toBeUndefined();
  });

  it("пустой/битый JSON → null", async () => {
    next = () => new Response("", { status: 200 });
    expect(await api("/nothing")).toBeNull();
    next = () => new Response("<html>", { status: 200 });
    expect(await api("/html")).toBeNull();
  });
});

describe("api(): ошибки", () => {
  it("не-2xx → ApiRequestError со статусом и кодом", async () => {
    next = () =>
      jsonResponse({ error: "OUT_OF_STOCK", message: "Мест нет" }, 409);
    const err = await api<never>("/payments/create", { method: "POST" }).catch(
      (e) => e as ApiRequestError
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("OUT_OF_STOCK");
    expect(err.message).toBe("Мест нет");
  });

  it("не-2xx без тела → дефолтное сообщение", async () => {
    next = () => new Response(null, { status: 502 });
    const err = await api<never>("/x").catch((e) => e as ApiRequestError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("Ошибка сервера (502).");
  });

  it("сеть недоступна → status 0, code NETWORK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const err = await api<never>("/me").catch((e) => e as ApiRequestError);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("NETWORK");
    expect(err.message).toBe("Нет связи с сервером. Попробуй позже.");
  });
});

describe("обёртки", () => {
  it("loginWithTelegram шлёт initData POST-ом на /auth/webapp", async () => {
    await loginWithTelegram("user=1&hash=abc");
    const { url, init } = calls[0];
    expect(url).toBe("/api/auth/webapp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ initData: "user=1&hash=abc" });
  });

  it("getMe гетит /me", async () => {
    await getMe();
    expect(calls[0].url).toBe("/api/me");
  });

  it("errorMessage: свой текст ошибок, иначе заглушка", () => {
    expect(errorMessage(new ApiRequestError(0, "NETWORK", "Нет связи"))).toBe(
      "Нет связи"
    );
    expect(errorMessage(new Error("просто"))).toBe("просто");
    expect(errorMessage("строка")).toBe("Что-то пошло не так.");
    expect(errorMessage(undefined)).toBe("Что-то пошло не так.");
  });
});
