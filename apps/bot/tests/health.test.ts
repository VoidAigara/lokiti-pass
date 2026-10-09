import { describe, expect, it } from "vitest";
import {
  createHealthMonitor,
  type FetchLike,
  type HealthMonitor,
  type LogLevel,
} from "../src/health.js";

type Mode =
  | { kind: "ok" }
  | { kind: "degraded" }
  | { kind: "http503"; body: unknown; jsonFails?: boolean }
  | { kind: "http"; status: number }
  | { kind: "reject"; message: string };

interface Harness {
  monitor: HealthMonitor;
  logs: Array<{ level: LogLevel; message: string }>;
  alerts: string[];
  setMode: (m: Mode) => void;
  setFetch: (fn: FetchLike) => void;
}

function defaultFetch(current: Mode): FetchLike {
  return async () => {
    if (current.kind === "reject") throw new Error(current.message);
    if (current.kind === "ok") {
      return { status: 200, ok: true, json: async () => ({ status: "ok" }) };
    }
    if (current.kind === "degraded") {
      return { status: 503, ok: false, json: async () => ({ status: "degraded" }) };
    }
    if (current.kind === "http503") {
      return {
        status: 503,
        ok: false,
        json: current.jsonFails
          ? async () => {
              throw new Error("bad json");
            }
          : async () => current.body,
      };
    }
    return {
      status: current.status,
      ok: current.status >= 200 && current.status < 300,
      json: async () => ({}),
    };
  };
}

function harness(mode: Mode = { kind: "ok" }, opts: { alertTarget?: string | null } = {}): Harness {
  const logs: Array<{ level: LogLevel; message: string }> = [];
  const alerts: string[] = [];
  let current: Mode = mode;
  const holder: { fn: FetchLike } = { fn: defaultFetch(current) };

  const monitor = createHealthMonitor({
    url: "http://api:8080/health",
    alertTarget: opts.alertTarget === undefined ? "12345" : opts.alertTarget,
    alertFn: async (text) => {
      alerts.push(text);
    },
    log: (level, message) => {
      logs.push({ level, message });
    },
    timeoutMs: 50,
    fetchFn: (url, init) => holder.fn(url, init),
  });

  return {
    monitor,
    logs,
    alerts,
    setMode: (m: Mode) => {
      current = m;
      holder.fn = defaultFetch(current);
    },
    setFetch: (fn: FetchLike) => {
      holder.fn = fn;
    },
  };
}

describe("health monitor: базовые переходы", () => {
  it("200 → состояние up, без логов и алертов", async () => {
    const h = harness();
    const state = await h.monitor.check();
    expect(state).toBe("up");
    expect(h.monitor.state).toBe("up");
    expect(h.monitor.downStreak).toBe(0);
    expect(h.logs).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  it("503 degraded → состояние degraded, один warn, streak сброшен", async () => {
    const h = harness({ kind: "degraded" });
    expect(await h.monitor.check()).toBe("degraded");
    expect(h.monitor.state).toBe("degraded");
    expect(h.monitor.downStreak).toBe(0);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(h.alerts).toHaveLength(0);

    // повторный degraded не дублирует warn (логируем только переход)
    await h.monitor.check();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("degraded → 200 → up с логом «api ok»", async () => {
    const h = harness({ kind: "degraded" });
    await h.monitor.check();
    h.setMode({ kind: "ok" });
    expect(await h.monitor.check()).toBe("up");
    expect(h.logs.some((l) => l.message.includes("api ok"))).toBe(true);
    expect(h.monitor.downStreak).toBe(0);
  });
});

describe("health monitor: hysteresis алертов", () => {
  it("первый сбой → состояние не down, только warn «ждём повторную»", async () => {
    const h = harness({ kind: "reject", message: "connect ECONNREFUSED" });
    expect(await h.monitor.check()).toBe("up");
    expect(h.monitor.state).toBe("up");
    expect(h.monitor.downStreak).toBe(1);
    expect(h.alerts).toHaveLength(0);
    expect(
      h.logs.some((l) => l.level === "warn" && l.message.includes("ждём повторную"))
    ).toBe(true);
  });

  it("два сбоя подряд → down, один алерт с URL health", async () => {
    const h = harness({ kind: "reject", message: "connect ECONNREFUSED" });
    await h.monitor.check();
    expect(await h.monitor.check()).toBe("down");
    expect(h.monitor.state).toBe("down");
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toContain("Loki Pass: API недоступен");
    expect(h.alerts[0]).toContain("connect ECONNREFUSED");
    expect(h.alerts[0]).toContain("http://api:8080/health");
    expect(h.logs.some((l) => l.level === "error" && l.message.includes("api down"))).toBe(
      true
    );
  });

  it("третий и четвёртый сбой → алерт не дублируется", async () => {
    const h = harness({ kind: "reject", message: "timeout" });
    await h.monitor.check();
    await h.monitor.check();
    expect(h.alerts).toHaveLength(1);
    await h.monitor.check();
    await h.monitor.check();
    expect(h.alerts).toHaveLength(1);
    expect(h.monitor.downStreak).toBe(4);
  });

  it("успешный чек сбрасывает streak: после восстановления один сбой снова без алерта", async () => {
    const h = harness({ kind: "reject", message: "boom" });
    await h.monitor.check();
    await h.monitor.check();
    expect(h.alerts).toHaveLength(1);

    h.setMode({ kind: "ok" });
    expect(await h.monitor.check()).toBe("up");
    expect(h.monitor.downStreak).toBe(0);

    h.setMode({ kind: "reject", message: "boom again" });
    await h.monitor.check();
    expect(h.monitor.state).toBe("up");
    expect(h.alerts).toHaveLength(1);
  });

  it("down → degraded (API снова отвечает) → streak сбрасывается, лог «снова отвечает»", async () => {
    const h = harness({ kind: "reject", message: "down" });
    await h.monitor.check();
    await h.monitor.check();
    expect(h.alerts).toHaveLength(1);

    h.setMode({ kind: "degraded" });
    expect(await h.monitor.check()).toBe("degraded");
    expect(h.monitor.downStreak).toBe(0);
    expect(h.logs.some((l) => l.message.includes("снова отвечает"))).toBe(true);

    // после degraded первый сбой снова НЕ алертит (streak был сброшен)
    h.setMode({ kind: "reject", message: "flap" });
    await h.monitor.check();
    expect(h.alerts).toHaveLength(1);
  });

  it("повторный переход degraded → down шлёт новый алерт", async () => {
    const h = harness({ kind: "reject", message: "first down" });
    await h.monitor.check();
    await h.monitor.check();
    h.setMode({ kind: "degraded" });
    await h.monitor.check();

    h.setMode({ kind: "reject", message: "second down" });
    await h.monitor.check();
    expect(await h.monitor.check()).toBe("down");
    expect(h.alerts).toHaveLength(2);
    expect(h.alerts[1]).toContain("second down");
  });
});

describe("health monitor: прочие ветки ответа", () => {
  it("HTTP 500 → сбой (throw), первый чек без алерта", async () => {
    const h = harness({ kind: "http", status: 500 });
    expect(await h.monitor.check()).toBe("up");
    expect(
      h.logs.some((l) => l.message.includes("HTTP 500") && l.message.includes("ждём"))
    ).toBe(true);
  });

  it("HTTP 503 с body НЕ degraded → сбой «HTTP 503», не degraded", async () => {
    const h = harness({ kind: "http503", body: { status: "error" } });
    expect(await h.monitor.check()).toBe("up");
    expect(
      h.logs.some((l) => l.message.includes("HTTP 503") && l.message.includes("ждём"))
    ).toBe(true);
    expect(h.monitor.state).toBe("up");
  });

  it("503 с неразбираемым JSON → сбой, а не зависание", async () => {
    const h = harness({ kind: "http503", body: null, jsonFails: true });
    expect(await h.monitor.check()).toBe("up");
    expect(h.monitor.downStreak).toBe(1);
  });

  it("висящий fetch обрывается по таймауту и учитывается как сбой", async () => {
    const h = harness();
    h.setFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    expect(await h.monitor.check()).toBe("up");
    expect(h.monitor.downStreak).toBe(1);
    expect(h.logs.some((l) => l.message.includes("abort"))).toBe(true);
  });
});

describe("health monitor: алерт опционален и безопасен", () => {
  it("падение alertFn не роняет проверку: состояние down", async () => {
    const monitor = createHealthMonitor({
      url: "http://api:8080/health",
      alertTarget: "12345",
      alertFn: async () => {
        throw new Error("telegram down");
      },
      log: () => undefined,
      fetchFn: async () => {
        throw new Error("boom");
      },
      timeoutMs: 50,
    });
    await monitor.check();
    expect(await monitor.check()).toBe("down");
    expect(monitor.state).toBe("down");
    expect(monitor.downStreak).toBe(2);
  });

  it("без alertTarget алерт не шлётся, но состояние становится down", async () => {
    const h = harness({ kind: "reject", message: "down" }, { alertTarget: null });
    await h.monitor.check();
    expect(await h.monitor.check()).toBe("down");
    expect(h.alerts).toHaveLength(0);
  });

  it("пустой alertTarget — алерт не шлётся, монитор работает", async () => {
    const h = harness({ kind: "reject", message: "x" }, { alertTarget: "" });
    await h.monitor.check();
    expect(await h.monitor.check()).toBe("down");
    expect(h.alerts).toHaveLength(0);
  });
});
