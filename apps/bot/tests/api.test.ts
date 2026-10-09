import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, api as apiNs, dropToken, getToken } from "../src/api.js";
import type { TgProfile } from "../src/api.js";

type FetchArgs = [input: string, init: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let calls: FetchArgs[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push([input, init]);
      if (input.endsWith("/auth/bot-session")) {
        return jsonResponse({ token: "jwt-abc", user: { id: "u1" } });
      }
      if (input.includes("/boom")) {
        return jsonResponse({ error: "NOPE", message: "Всё сломалось" }, 500);
      }
      if (input.includes("/text-error")) {
        return new Response("<html>ошибка</html>", { status: 502 });
      }
      if (input.includes("/empty")) {
        return new Response("", { status: 200 });
      }
      return jsonResponse({ ok: true, path: input });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getToken", () => {
  it("запрашивает JWT и кэширует по tgId", async () => {
    const profile: TgProfile = { tgId: 111, firstName: "Локи", username: "loki" };
    const t1 = await getToken(profile);
    const t2 = await getToken(profile);
    expect(t1).toBe("jwt-abc");
    expect(t2).toBe("jwt-abc");
    const sessionCalls = calls.filter(([u]) => u.endsWith("/auth/bot-session"));
    expect(sessionCalls).toHaveLength(1);
    expect(sessionCalls[0][1].method).toBe("POST");
    expect(JSON.parse(sessionCalls[0][1].body as string)).toEqual({
      tgId: "111",
      firstName: "Локи",
      tgUsername: "loki",
    });
  });

  it("dropToken сбрасывает кэш", async () => {
    const profile: TgProfile = { tgId: 222 };
    await getToken(profile);
    dropToken(222);
    await getToken(profile);
    expect(calls.filter(([u]) => u.endsWith("/auth/bot-session"))).toHaveLength(2);
  });

  it("пустые имя/юзернейм уходят как null", async () => {
    await getToken({ tgId: 333 });
    const body = JSON.parse(calls[0][1].body as string);
    expect(body.firstName).toBeNull();
    expect(body.tgUsername).toBeNull();
  });
});

describe("api: методы и заголовки", () => {
  it("GET с Bearer-токеном", async () => {
    const res = await api.get<{ ok: boolean }>("tok-1", "/me");
    expect(res.ok).toBe(true);
    const [url, init] = calls[0];
    expect(url).toBe("http://localhost:3001/me");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-1"
    );
  });

  it("POST и PATCH передают тело и метод", async () => {
    await api.post("t", "/x", { a: 1 });
    await api.patch("t", "/y", { b: 2 });
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ a: 1 });
    expect(calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ b: 2 });
  });

  it("anon — без заголовка авторизации", async () => {
    await apiNs.anon("/public/status");
    expect((calls[0][1].headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe("api: ошибки", () => {
  it("не-2xx → ApiError с кодом и сообщением из тела", async () => {
    const err = await api.get("/t", "/boom").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.code).toBe("NOPE");
    expect(err.message).toBe("Всё сломалось");
  });

  it("тело не-JSON → ApiError с дефолтным сообщением", async () => {
    const err = await api.get("/t", "/text-error").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("INTERNAL");
    expect(err.message).toBe("API вернул 502");
  });

  it("пустой ответ → null", async () => {
    expect(await api.get("/t", "/empty")).toBeNull();
  });
});
