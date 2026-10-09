import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    connects: 0,
    ends: 0,
    sentCommands: [] as string[],
    failConnects: 0,
    failSends: 0,
    sendResult: "ok",
  };
  class FakeRcon {
    async connect(): Promise<void> {
      state.connects++;
      if (state.failConnects > 0) {
        state.failConnects--;
        throw new Error("connect refused");
      }
    }
    async send(command: string): Promise<string> {
      state.sentCommands.push(command);
      if (state.failSends > 0) {
        state.failSends--;
        throw new Error("socket closed");
      }
      return state.sendResult;
    }
    async end(): Promise<void> {
      state.ends++;
    }
  }
  return { state, FakeRcon };
});

const rconState = h.state;

vi.mock("rcon-client", () => ({ Rcon: h.FakeRcon }));

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      MC_HOST: "mc.test",
      MC_RCON_PORT: 25575,
      MC_RCON_PASSWORD: "secret_pw",
    },
  };
});

import { closeRcon, rconHealth, rconSend, whitelistAdd, whitelistRemove } from "../src/lib/rcon.js";

beforeEach(() => {
  rconState.connects = 0;
  rconState.ends = 0;
  rconState.sentCommands = [];
  rconState.failConnects = 0;
  rconState.failSends = 0;
  rconState.sendResult = "ok";
});

afterEach(async () => {
  await closeRcon();
});

describe("rcon", () => {
  it("whitelistAdd: валидный ник → команда, один connect", async () => {
    const res = await whitelistAdd("Loki_2026");
    expect(res).toBe("ok");
    expect(rconState.sentCommands).toEqual(["whitelist add Loki_2026"]);
    expect(rconState.connects).toBe(1);

    // повторное использование живого соединения
    await whitelistRemove("Loki_2026");
    expect(rconState.connects).toBe(1);
    expect(rconState.sentCommands[1]).toBe("whitelist remove Loki_2026");
  });

  it("недопустимый ник → ошибка до подключения", async () => {
    await expect(whitelistAdd("плохой ник")).rejects.toThrow(/Недопустимый ник/);
    await expect(whitelistAdd("ab")).rejects.toThrow(/Недопустимый ник/);
    await expect(whitelistAdd("A".repeat(17))).rejects.toThrow(/Недопустимый ник/);
    expect(rconState.connects).toBe(0);
    expect(rconState.sentCommands).toHaveLength(0);
  });

  it("send падает → переподключение и повторная отправка", async () => {
    rconState.failSends = 1;
    const res = await rconSend("list");
    expect(res).toBe("ok");
    expect(rconState.connects).toBe(2);
    expect(rconState.ends).toBeGreaterThanOrEqual(1);
    expect(rconState.sentCommands).toEqual(["list", "list"]);
  });

  it("обе попытки падают → ошибка", async () => {
    rconState.failSends = 2;
    await expect(rconSend("list")).rejects.toThrow(/socket closed/);
    expect(rconState.connects).toBeGreaterThanOrEqual(1);
  });

  it("rconHealth: успех → ok", async () => {
    rconState.sendResult = "There are 0 of a max of 20 players online";
    expect(await rconHealth()).toEqual({
      ok: true,
      message: undefined,
    });
  });

  it("rconHealth: ошибка → ok:false c текстом", async () => {
    rconState.failSends = 2;
    const health = await rconHealth();
    expect(health.ok).toBe(false);
    expect(health.message).toMatch(/socket closed/);
  });
});
