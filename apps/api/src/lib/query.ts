import dgram from "node:dgram";
import { env } from "../config.js";

export interface ServerStatus {
  online: number;
  max: number;
  hostname?: string;
  version?: string;
  map?: string;
}

const SESSION_ID = 0x00000001;

function readChallenge(payload: Buffer): number {
  // <sessionid:4><challenge token as ASCII>\0
  const str = payload.subarray(4).toString("latin1").replace(/\0+$/, "");
  const n = Number.parseInt(str, 10);
  if (!Number.isFinite(n)) throw new Error("Некорректный challenge token");
  return n;
}

function pickField(parts: string[], key: string): string | undefined {
  const idx = parts.indexOf(key);
  if (idx === -1) return undefined;
  const v = parts[idx + 1];
  return v === undefined || v === "" ? undefined : v;
}

function parseFullStat(payload: Buffer): ServerStatus {
  const parts = payload.subarray(4).toString("latin1").split("\0");
  const online = Number(pickField(parts, "numplayers") ?? "0");
  const max = Number(pickField(parts, "maxplayers") ?? "0");
  return {
    online: Number.isFinite(online) ? online : 0,
    max: Number.isFinite(max) ? max : 0,
    hostname: pickField(parts, "hostname"),
    version: pickField(parts, "version"),
    map: pickField(parts, "map"),
  };
}

function udpExchange(
  socket: dgram.Socket,
  host: string,
  port: number,
  req: Buffer,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Query timeout"));
    }, timeoutMs);

    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.once("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });

    socket.send(req, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

/**
 * Minecraft GameQuery (UDP, «Query» должен быть включён в server.properties:
 *   enable-query=true, query.port=25565).
 * Используется для виджета «сейчас онлайн».
 */
export async function queryServerStatus(
  timeoutMs = 3000
): Promise<ServerStatus> {
  const host = env.MC_QUERY_HOST;
  const port = env.MC_QUERY_PORT;

  // 1) handshake — получаем challenge token
  const hsSocket = dgram.createSocket("udp4");
  const hsReq = Buffer.from([0xfe, 0xfd, 0x09, 0x00, 0x00, 0x00, SESSION_ID]);
  const hsResp = await udpExchange(hsSocket, host, port, hsReq, timeoutMs);
  const challenge = readChallenge(hsResp);

  // 2) full stat
  const statSocket = dgram.createSocket("udp4");
  const statReq = Buffer.alloc(11 + 4 + 4 + 8);
  statReq.writeUInt8(0xfe, 0);
  statReq.writeUInt8(0xfd, 1);
  statReq.writeUInt8(0x00, 2);
  statReq.writeUInt32BE(SESSION_ID, 3);
  statReq.writeInt32BE(challenge, 7);
  // 8 байт padding "00000000"
  statReq.write("00000000", 11, "latin1");

  const statResp = await udpExchange(statSocket, host, port, statReq, timeoutMs);
  return parseFullStat(statResp);
}
