import { describe, expect, it } from "vitest";
import { validateMcNick, isValidMcNick } from "../src/validation.js";
import { MC_NICK_REGEX, RESERVED_NICKS } from "../src/constants.js";

describe("validateMcNick: границы длины", () => {
  it("3 символа — валидно", () => {
    for (const nick of ["abc", "a_1", "123", "___"]) {
      expect(validateMcNick(nick).ok, nick).toBe(true);
    }
  });

  it("16 символов — валидно", () => {
    expect(validateMcNick("A".repeat(16)).ok).toBe(true);
    expect(validateMcNick("1234567890123456").ok).toBe(true);
    expect(validateMcNick("________________").ok).toBe(true);
  });

  it("2 символа — невалидно, длина раньше regex", () => {
    const res = validateMcNick("ab");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/от 3 до 16/);
  });

  it("17 символов — невалидно", () => {
    expect(validateMcNick("A".repeat(17)).ok).toBe(false);
    expect(validateMcNick("NickNameIsTooLong").ok).toBe(false);
  });
});

describe("validateMcNick: допустимые символы", () => {
  it("латиница в обоих регистрах, цифры и подчёркивание", () => {
    for (const nick of ["Steve", "Loki_Ti", "x_1", "Zz9_9z", "snake_case_nick"]) {
      expect(validateMcNick(nick).ok, nick).toBe(true);
    }
  });

  it("кириллица — невалидно", () => {
    for (const nick of ["никил", "Никил", "с__id", "Стример"]) {
      const res = validateMcNick(nick);
      expect(res.ok, nick).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/кириллица/i);
    }
  });

  it("пробелы внутри — невалидно; по краям — обрезаются (trim)", () => {
    expect(validateMcNick("with space").ok).toBe(false);
    expect(validateMcNick("a b c").ok).toBe(false);
    expect(validateMcNick(" lead").ok).toBe(true);
    expect(validateMcNick("trail ").ok).toBe(true);
  });

  it("прочие символы (- . # @ и т.п.) — невалидно", () => {
    for (const nick of ["my-nick", "my.nick", "nick#1", "nick@x", "nick!", "nick?"]) {
      expect(validateMcNick(nick).ok, nick).toBe(false);
    }
  });

  it("эмодзи и прочий non-ASCII — невалидно", () => {
    expect(validateMcNick("nick🚀").ok).toBe(false);
    expect(validateMcNick("ник🚀").ok).toBe(false);
    expect(validateMcNick("nické").ok).toBe(false);
  });

  it("пустая строка и пробелы — свой reason", () => {
    const empty = validateMcNick("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toMatch(/пустым/);

    const spaces = validateMcNick("   ");
    expect(spaces.ok).toBe(false);
    if (!spaces.ok) expect(spaces.reason).toMatch(/пустым/);
  });

  it("trim: валидный ник с пробелами по краям проходит и обрезается", () => {
    const res = validateMcNick("  PaddedNick  ");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.nick).toBe("PaddedNick");
      expect(res.nickLower).toBe("paddednick");
    }
  });
});

describe("validateMcNick: зарезервированные ники", () => {
  it("каждый резервный ник (длиной ≥3) отклоняется с соответствующим reason", () => {
    for (const reserved of RESERVED_NICKS) {
      if (reserved.length < 3) continue; // "op" и т.п. отсекаются ещё по длине
      const res = validateMcNick(reserved);
      expect(res.ok, reserved).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/зарезервирован/);
    }
  });

  it("резерв проверяется без учёта регистра", () => {
    for (const nick of ["ADMIN", "Admin", "LoKi", "SERVER", "Null"]) {
      const res = validateMcNick(nick);
      expect(res.ok, nick).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/зарезервирован/);
    }
  });

  it("короткий резервный ник («op») отсекается по длине, не по резерву", () => {
    const res = validateMcNick("op");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/от 3 до 16/);
  });

  it("резервный ник с подчёркиваниями НЕ совпадает (точное сравнение)", () => {
    expect(validateMcNick("admin_1").ok).toBe(true);
    expect(validateMcNick("_admin").ok).toBe(true);
    expect(validateMcNick("adminx").ok).toBe(true);
  });
});

describe("validateMcNick: результат и консистентность", () => {
  it("nickLower = nick.toLowerCase(), регистр сохраняется в nick", () => {
    const res = validateMcNick("LoKi_Ti99");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.nick).toBe("LoKi_Ti99");
      expect(res.nickLower).toBe("loki_ti99");
    }
  });

  it("одинаковые ники в разных регистрах дают одинаковый nickLower (антиколлизия)", () => {
    const a = validateMcNick("SameNick");
    const b = validateMcNick("samenick");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.nickLower).toBe(b.nickLower);
  });

  it("isValidMcNick эквивалентен validateMcNick().ok", () => {
    const samples = ["Steve", "ab", "Никил", "ADMIN", "nick_1", "", "too_long_nick_here"];
    for (const s of samples) {
      expect(isValidMcNick(s), s).toBe(validateMcNick(s).ok);
    }
  });

  it("все reason — непустые строки", () => {
    const bad = ["", "ab", "Nick Is Too Long!!", "никил", "ADMIN"];
    for (const s of bad) {
      const res = validateMcNick(s);
      expect(res.ok, s).toBe(false);
      if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    }
  });

  it("MC_NICK_REGEX сам по себе: точность границ", () => {
    expect(MC_NICK_REGEX.test("abc")).toBe(true);
    expect(MC_NICK_REGEX.test("ab")).toBe(false);
    expect(MC_NICK_REGEX.test("a".repeat(16))).toBe(true);
    expect(MC_NICK_REGEX.test("a".repeat(17))).toBe(false);
    expect(MC_NICK_REGEX.test("with space")).toBe(false);
    expect(MC_NICK_REGEX.test("nick-dash")).toBe(false);
  });
});
