import { describe, expect, it } from "vitest";
import { broadcast } from "../src/adapters/notifier-helpers.js";
import type { Deps } from "../src/services/ports.js";

function makeDeps(opts: {
  users: Record<string, { tgId: string } | null>;
  failingTgIds?: Set<string>;
}): {
  deps: Deps;
  notified: string[];
} {
  const notified: string[] = [];
  const deps = {
    store: {
      getUserById: async (id: string) => opts.users[id] ?? null,
    },
    notifier: {
      broadcast: async (tgId: string) => {
        if (opts.failingTgIds?.has(String(tgId))) throw new Error("blocked by user");
        notified.push(String(tgId));
      },
    },
  } as unknown as Deps;
  return { deps, notified };
}

describe("notifier-helpers: broadcast", () => {
  it("считает отправленные, пропускает неизвестных, не роняет процесс на ошибках", async () => {
    const { deps, notified } = makeDeps({
      users: {
        u1: { tgId: "111" },
        u2: { tgId: "222" },
        u3: null,
        u4: { tgId: "444" },
      },
      failingTgIds: new Set(["222"]),
    });

    const res = await broadcast(deps, ["u1", "u2", "u3", "u4", "ghost"], "<b>скидка</b>");
    expect(res).toEqual({ sent: 2, failed: 1 });
    expect(notified).toEqual(["111", "444"]);
  });

  it("троттлинг: после 25 адресатов пауза, но итог не меняется", async () => {
    const users: Record<string, { tgId: string }> = {};
    const ids: string[] = [];
    for (let i = 0; i < 26; i++) {
      const id = `u_${i}`;
      users[id] = { tgId: String(1000 + i) };
      ids.push(id);
    }
    const { deps, notified } = makeDeps({ users });

    const res = await broadcast(deps, ids, "text");
    expect(res).toEqual({ sent: 26, failed: 0 });
    expect(notified).toHaveLength(26);
  }, 15_000);
});
