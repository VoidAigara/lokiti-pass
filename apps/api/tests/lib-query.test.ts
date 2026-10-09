import { afterAll, describe, expect, it, vi } from "vitest";
import dgram from "node:dgram";

const h = vi.hoisted(() => ({ QUERY_PORT: 25599 }));

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      MC_QUERY_HOST: "127.0.0.1",
      MC_QUERY_PORT: h.QUERY_PORT,
    },
  };
});

import { queryServerStatus } from "../src/lib/query.js";

const QUERY_PORT = h.QUERY_PORT;

type Mode = "ok" | "bad-challenge" | "silent";

function startServer(mode: Mode): Promise<{ close: () => Promise<void>; gotStat: () => boolean }> {
  return new Promise((resolve, reject) => {
    let statSeen = false;
    const sock = dgram.createSocket("udp4");
    sock.on("error", reject);
    sock.on("message", (msg, rinfo) => {
      if (mode === "silent") return;
      const type = msg.readUInt8(2);
      if (type === 0x09) {
        // handshake → 4 байта сессии + ASCII challenge
        const challenge = mode === "bad-challenge" ? "XYZ" : "12345";
        const resp = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from(`${challenge}\0`, "latin1")]);
        sock.send(resp, rinfo.port, rinfo.address);
        return;
      }
      if (type === 0x00) {
        // full stat: клиент пишет challenge BE по смещению 7
        if (mode === "ok") {
          const sent = msg.readInt32BE(7);
          if (sent !== 12345) return; // неправильный challenge → таймаут теста
        }
        statSeen = true;
        const pairs =
          "numplayers\u0000" +
          "7\u0000" +
          "maxplayers\u0000" +
          "20\u0000" +
          "hostname\u0000LokiCraft\u0000" +
          "version\u00001.21\u0000" +
          "map\u0000world\u0000" +
          "\u0000";
        const resp = Buffer.concat([
          Buffer.from([0, 0, 0, 1]),
          Buffer.from(pairs, "latin1"),
        ]);
        sock.send(resp, rinfo.port, rinfo.address);
        return;
      }
    });
    sock.bind(QUERY_PORT, "127.0.0.1", () =>
      resolve({
        close: () => new Promise<void>((r) => sock.close(r)),
        gotStat: () => statSeen,
      })
    );
  });
}

describe("queryServerStatus (UDP GameQuery)", () => {
  it("handshake + full stat → разобранный статус", async () => {
    const server = await startServer("ok");
    try {
      const status = await queryServerStatus(3000);
      expect(status).toEqual({
        online: 7,
        max: 20,
        hostname: "LokiCraft",
        version: "1.21",
        map: "world",
      });
      expect(server.gotStat()).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("нечисловой challenge → понятная ошибка", async () => {
    const server = await startServer("bad-challenge");
    try {
      await expect(queryServerStatus(3000)).rejects.toThrow(/Некорректный challenge token/);
    } finally {
      await server.close();
    }
  });

  it("нет ответа → Query timeout", async () => {
    const server = await startServer("silent");
    try {
      await expect(queryServerStatus(300)).rejects.toThrow(/Query timeout/);
    } finally {
      await server.close();
    }
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});
