import { pino } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { env, isProd } from "../config.js";

export const logger: FastifyBaseLogger = pino({
  level: env.LOG_LEVEL,
  base: { app: "loki-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-internal-token",
      "password",
      "secret",
      "token",
      "BOT_TOKEN",
      "YOOKASSA_SECRET_KEY",
    ],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
