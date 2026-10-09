import { SignJWT, jwtVerify } from "jose";
import { sha256Hex } from "@loki/shared";
import { env } from "../config.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface JwtPayload {
  sub: string; // User.id
  tgId: string; // string, т.к. BigInt не влезает в JWT
  isAdmin: boolean;
  sid: string; // Session.id
}

function ttlToSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 7 * 24 * 3600;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return n * mult;
}

export const JWT_TTL_SECONDS = ttlToSeconds(env.JWT_TTL);

export async function signAccessToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ tgId: payload.tgId, isAdmin: payload.isAdmin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.sid)
    .setIssuedAt()
    .setIssuer("loki-pass")
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: "loki-pass",
      // пиним алгоритм: запрещаем подмену на «безопасные» none/другие alg
      algorithms: ["HS256"],
    });
    if (!payload.sub || !payload.jti) return null;
    return {
      sub: payload.sub,
      tgId: String(payload.tgId ?? ""),
      isAdmin: payload.isAdmin === true,
      sid: payload.jti,
    };
  } catch {
    return null;
  }
}

/** Хэш токена для таблицы Session — сам токен в БД не храним. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
