import { Rcon } from "rcon-client";
import { MC_NICK_REGEX } from "@loki/shared";
import { env } from "../config.js";
import { logger } from "./logger.js";

let client: Rcon | null = null;
let connected = false;
let connecting: Promise<Rcon> | null = null;

function createClient(): Rcon {
  return new Rcon({
    host: env.MC_HOST,
    port: env.MC_RCON_PORT,
    password: env.MC_RCON_PASSWORD,
    timeout: 8000,
  });
}

async function ensureConnected(): Promise<Rcon> {
  if (client && connected) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = createClient();
    await c.connect();
    client = c;
    connected = true;
    logger.debug("RCON подключён");
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function safeNick(nick: string): string {
  if (!MC_NICK_REGEX.test(nick)) {
    throw new Error(`Недопустимый ник для RCON: ${nick}`);
  }
  return nick;
}

/** Выполнить RCON-команду. Один раз ретраит переподключение. */
export async function rconSend(command: string): Promise<string> {
  if (!env.MC_RCON_PASSWORD) {
    throw new Error("MC_RCON_PASSWORD не задан — RCON отключён");
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await ensureConnected();
      return await c.send(command);
    } catch (err) {
      lastErr = err;
      logger.warn({ err, command }, "RCON ошибка, пробуем переподключиться");
      try {
        await client?.end();
      } catch {
        /* ignore */
      }
      client = null;
      connected = false;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function whitelistAdd(nick: string): Promise<string> {
  return rconSend(`whitelist add ${safeNick(nick)}`);
}

export async function whitelistRemove(nick: string): Promise<string> {
  return rconSend(`whitelist remove ${safeNick(nick)}`);
}

export async function rconHealth(): Promise<{ ok: boolean; message?: string }> {
  if (!env.MC_RCON_PASSWORD) {
    return { ok: false, message: "RCON password не задан" };
  }
  try {
    await rconSend("list");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeRcon(): Promise<void> {
  try {
    await client?.end();
  } catch {
    /* ignore */
  }
  client = null;
  connected = false;
}
