import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api.js";
import { callApi, humanApiError, isAdminCtx, profileOf } from "../src/helpers.js";

function fakeCtx(from?: { id: number; first_name?: string; username?: string }) {
  return { from } as never;
}

describe("helpers: profileOf", () => {
  it("собирает профиль из ctx.from", () => {
    const p = profileOf(fakeCtx({ id: 42, first_name: "Локи", username: "loki" }));
    expect(p).toEqual({ tgId: 42, firstName: "Локи", username: "loki" });
  });

  it("без first_name/username — null", () => {
    const p = profileOf(fakeCtx({ id: 42 }));
    expect(p).toEqual({ tgId: 42, firstName: null, username: null });
  });

  it("нет from — ошибка", () => {
    expect(() => profileOf(fakeCtx(undefined))).toThrow(/Нет данных отправителя/);
    expect(() => profileOf({} as never)).toThrow(/Нет данных отправителя/);
  });
});

describe("helpers: isAdminCtx", () => {
  it("админ по ADMIN_TG_IDS из vitest.config", () => {
    expect(isAdminCtx(fakeCtx({ id: 968_363_862 }))).toBe(true);
  });

  it("не админ / нет from", () => {
    expect(isAdminCtx(fakeCtx({ id: 1 }))).toBe(false);
    expect(isAdminCtx(fakeCtx(undefined))).toBe(false);
  });
});

describe("helpers: humanApiError", () => {
  it("ApiError и Error — свой message", () => {
    expect(humanApiError(new ApiError(404, "NOT_FOUND", "Сезон не найден"))).toBe(
      "Сезон не найден"
    );
    expect(humanApiError(new Error("просто ошибка"))).toBe("просто ошибка");
  });

  it("не-Error — заглушка", () => {
    expect(humanApiError("string")).toBe("Неизвестная ошибка");
    expect(humanApiError(undefined)).toBe("Неизвестная ошибка");
    expect(humanApiError({ foo: 1 })).toBe("Неизвестная ошибка");
  });
});

describe("helpers: callApi — рефреш токена на 401", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const state = { sessions: 0, meCalls: 0, authHeaders: [] as string[] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        if (url.endsWith("/auth/bot-session")) {
          state.sessions += 1;
          return new Response(
            JSON.stringify({ token: `tok-${state.sessions}`, user: {} }),
            { status: 200 }
          );
        }
        state.authHeaders.push(headers.authorization ?? "");
        state.meCalls += 1;
        if (state.meCalls === 1) {
          return new Response(
            JSON.stringify({ error: "UNAUTHORIZED", message: "Токен протух" }),
            { status: 401 }
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
    return state;
  }

  it("401 → сброс кэша, новый токен и повтор запроса", async () => {
    const state = stubFetch();
    const ctx = fakeCtx({ id: 777_001 });
    const res = await callApi<{ ok: boolean }>(ctx, "/me");
    expect(res.ok).toBe(true);
    expect(state.sessions).toBe(2);
    expect(state.authHeaders).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("не-401 не ретраится", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/bot-session")) {
          return new Response(
            JSON.stringify({ token: "tok-x", user: {} }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({ error: "NOPE", message: "Ошибка" }),
          { status: 500 }
        );
      })
    );
    const ctx = fakeCtx({ id: 777_002 });
    const err = await callApi(ctx, "/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});
