import * as net from "node:net";

/**
 * Мини-сервер RCON (Source/Minecraft protocol) для локального прогона E2E
 * без запущенного Minecraft. Принимает подключение от rcon-client,
 * отвечает на авторизацию и команды, запоминает все команды.
 *
 * Используется только скриптом scripts/smoke.ts.
 */
export interface FakeRcon {
  port: number;
  commands: string[];
  close(): Promise<void>;
}

function encode(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, "utf8");
  const packet = Buffer.alloc(14 + payload.length);
  packet.writeInt32LE(payload.length + 10, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  return packet;
}

function replyFor(command: string): string {
  const add = /^whitelist add ([A-Za-z0-9_]{3,16})$/.exec(command);
  if (add) return `Added ${add[1]} to the whitelist`;
  const remove = /^whitelist remove ([A-Za-z0-9_]{3,16})$/.exec(command);
  if (remove) return `Removed ${remove[1]} from the whitelist`;
  if (command === "list") return "There are 0/20 players online:";
  if (command.startsWith("whitelist ")) return "Whitelist is now enforced";
  return `ok: ${command}`;
}

export function startFakeRcon(opts: {
  port: number;
  password: string;
}): Promise<FakeRcon> {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const len = buffer.readInt32LE(0);
        if (len < 10 || len > 4096 + 14) {
          socket.destroy();
          return;
        }
        if (buffer.length < 4 + len) break;

        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const payload = buffer
          .subarray(12, 4 + len - 2)
          .toString("utf8")
          .replace(/\0+$/, "");
        buffer = buffer.subarray(4 + len);

        if (type === 3) {
          const ok = payload === opts.password;
          socket.write(encode(ok ? id : -1, 2, ""));
        } else if (type === 2) {
          commands.push(payload);
          socket.write(encode(id, 0, replyFor(payload)));
        }
      }
    });

    socket.on("error", () => {
      /* клиент мог закрыть соединение */
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "0.0.0.0", () => {
      resolve({
        port: opts.port,
        commands,
        close: () =>
          new Promise<void>((res) => {
            // активные RCON-соединения держат event loop — закрываем принудительно
            for (const s of sockets) s.destroy();
            sockets.clear();
            server.close(() => res());
          }),
      });
    });
  });
}
