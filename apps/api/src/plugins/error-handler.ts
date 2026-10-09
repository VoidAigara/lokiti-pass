import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ServiceError } from "../services/payments.js";
import { logger } from "../lib/logger.js";

const CODE_TO_HTTP: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  NO_SEASON: 409,
  ALREADY_ACTIVE: 409,
  NICK_TAKEN: 409,
  NICK_REQUIRED: 400,
  PAYMENT_FAILED: 502,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as Error & { statusCode?: number };

    if (err instanceof ZodError) {
      reply.code(400).send({
        error: "VALIDATION",
        message: "Некорректные данные запроса.",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    if (err instanceof ServiceError) {
      reply.code(CODE_TO_HTTP[err.code] ?? 400).send({
        error: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }

    const statusCode = err.statusCode ?? 500;
    if (statusCode === 429) {
      reply.code(429).send({
        error: "RATE_LIMITED",
        message: "Слишком много запросов. Попробуй через минуту.",
      });
      return;
    }

    logger.error({ err, url: req.url }, "unhandled error");
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "INTERNAL" : "VALIDATION",
      message: statusCode >= 500 ? "Внутренняя ошибка сервера." : err.message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: "NOT_FOUND", message: "Маршрут не найден." });
  });
}
