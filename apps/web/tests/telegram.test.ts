import { describe, expect, it } from "vitest";
import {
  deepLink,
  getTelegramWebApp,
  haptic,
  initTelegramWebApp,
  inTelegram,
  isTelegramWebApp,
  notify,
} from "../lib/telegram.js";

describe("telegram: вне браузера (node, window нет)", () => {
  it("getTelegramWebApp/isTelegramWebApp — undefined/false", () => {
    expect(typeof window).toBe("undefined");
    expect(getTelegramWebApp()).toBeUndefined();
    expect(isTelegramWebApp()).toBe(false);
  });

  it("initTelegramWebApp — null без WebApp", () => {
    expect(initTelegramWebApp()).toBeNull();
  });

  it("inTelegram — false без initData", () => {
    expect(inTelegram()).toBe(false);
  });

  it("haptic/notify — тихие no-op, не бросают", () => {
    expect(() => haptic()).not.toThrow();
    expect(() => haptic("heavy")).not.toThrow();
    expect(() => notify("error")).not.toThrow();
  });

  it("deepLink — t.me/юзернейм/путь", () => {
    expect(deepLink("/start")).toBe("https://t.me/lokitiserver_bot/start");
  });
});
