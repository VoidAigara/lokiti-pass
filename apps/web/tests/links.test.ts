import { describe, expect, it } from "vitest";
import { BOT_USERNAME, botUrl, deepLink } from "../lib/links.js";

describe("links", () => {
  it("deepLink добавляет путь к юзернейму бота", () => {
    expect(deepLink("/start")).toBe(`https://t.me/${BOT_USERNAME}/start`);
    expect(deepLink("")).toBe(`https://t.me/${BOT_USERNAME}`);
  });

  it("botUrl — просто на бота", () => {
    expect(botUrl()).toBe(`https://t.me/${BOT_USERNAME}`);
    expect(botUrl()).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+$/);
  });

  it("юзернейм без @", () => {
    expect(BOT_USERNAME.startsWith("@")).toBe(false);
    expect(BOT_USERNAME).toMatch(/^[A-Za-z0-9_]+$/);
  });
});
