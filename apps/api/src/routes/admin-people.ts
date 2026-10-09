import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TICKET_LIMITS, validateMcNick } from "@loki/shared";
import { adminGuard } from "../plugins/admin.js";
import { getClientIp } from "../plugins/auth.js";
import { prismaStore } from "../services/store-prisma.js";
import {
  approveNickChange,
  banPlayer,
  rejectNickChange,
  unbanPlayer,
} from "../services/admin.js";
import { AUDIT_ACTIONS } from "@loki/shared";
import type { Deps } from "../services/ports.js";

const BanBody = z.object({
  nick: z.string().min(3).max(16),
  reason: z.string().min(3).max(300),
});

const ResolveTicket = z.object({
  status: z.enum(["APPROVED", "REJECTED", "CLOSED"]),
  note: z.string().max(500).optional(),
});

const RejectBody = z.object({ note: z.string().max(500).optional() });

const BroadcastBody = z.object({
  text: z.string().min(1).max(4000),
  target: z.enum(["ACTIVE", "ALL", "EXPIRED"]).default("ACTIVE"),
});

export function adminPeopleRoutes(
  deps: Deps
): (app: FastifyInstance) => Promise<void> {
  return async function (app: FastifyInstance) {
    app.addHook("preHandler", adminGuard);

    app.get("/admin/players", async (req, reply) => {
      const q = z
        .object({
          status: z.enum(["ACTIVE", "EXPIRED", "PENDING", "BANNED"]).optional(),
          search: z.string().max(30).optional(),
        })
        .parse(req.query);

      let players = await prismaStore.listAllPlayers();
      if (q.status) players = players.filter((p) => p.status === q.status);
      if (q.search) {
        const s = q.search.toLowerCase();
        players = players.filter((p) => p.mcNickLower.includes(s));
      }

      const users = new Map<string, Awaited<ReturnType<typeof prismaStore.getUserById>>>();
      const items = await Promise.all(
        players.slice(0, 300).map(async (p) => {
          if (!users.has(p.userId)) {
            users.set(p.userId, await prismaStore.getUserById(p.userId));
          }
          const u = users.get(p.userId) ?? null;
          return {
            ...p,
            tgId: u?.tgId ?? null,
            tgUsername: u?.tgUsername ?? null,
            firstName: u?.firstName ?? null,
          };
        })
      );

      reply.send({ players: items, total: players.length });
    });

    app.post("/admin/players/ban", async (req, reply) => {
      const body = BanBody.parse(req.body);
      const player = await banPlayer(deps, body.nick, body.reason, {
        actorId: req.auth!.user.id,
        actorTgId: req.auth!.user.tgId,
        ip: getClientIp(req),
      });
      reply.send({ player });
    });

    app.post("/admin/players/unban", async (req, reply) => {
      const body = z.object({ nick: z.string().min(3).max(16) }).parse(req.body);
      const player = await unbanPlayer(deps, body.nick, {
        actorId: req.auth!.user.id,
        actorTgId: req.auth!.user.tgId,
        ip: getClientIp(req),
      });
      reply.send({ player });
    });

    /** Проверка ника: свободен ли, валиден ли. */
    app.get("/admin/nick-check", async (req, reply) => {
      const q = z.object({ nick: z.string().min(1).max(24) }).parse(req.query);
      const v = validateMcNick(q.nick);
      if (!v.ok) {
        reply.send({ valid: false, reason: v.reason, taken: false });
        return;
      }
      const taken = await prismaStore.getPlayerByNickLower(v.nickLower);
      reply.send({ valid: true, taken: Boolean(taken), takenBy: taken?.mcNick ?? null });
    });

    // ---------------- тикеты ----------------
    app.get("/admin/tickets", async (req, reply) => {
      const q = z
        .object({ status: z.enum(["OPEN", "APPROVED", "REJECTED", "CLOSED"]).optional() })
        .parse(req.query);
      const tickets = await prismaStore.listTicketDetails(
        q.status as never
      );
      reply.send({ tickets });
    });

    app.post<{ Params: { id: string } }>(
      "/admin/tickets/:id/resolve",
      async (req, reply) => {
        const body = ResolveTicket.parse(req.body);
        const ticket = await prismaStore.getTicket(req.params.id);
        if (!ticket) {
          reply.code(404).send({ error: "NOT_FOUND", message: "Тикет не найден." });
          return;
        }

        const updated = await prismaStore.updateTicket(ticket.id, {
          status: body.status,
          resolutionNote: body.note ?? null,
          resolvedAt: new Date(),
        });

        await prismaStore.writeAudit({
          actorId: req.auth!.user.id,
          actorTgId: req.auth!.user.tgId,
          action: AUDIT_ACTIONS.TICKET_RESOLVE,
          entity: "Ticket",
          entityId: ticket.id,
          meta: { status: body.status, note: body.note ?? null },
          ip: getClientIp(req),
        });

        const user = await prismaStore.getUserById(ticket.userId);
        if (user) {
          const { sendMessage } = await import("../lib/telegram.js");
          // note — ввод админа, но попадает в parse_mode=HTML ⇒ экранируем
          const noteHtml = body.note
            ? `\nКомментарий: ${body.note
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}`
            : "";
          await sendMessage(
            Number(user.tgId),
            `🎫 <b>Тикет обновлён</b>\nСтатус: <b>${body.status}</b>${noteHtml}`
          );
        }

        reply.send({ ticket: updated });
      }
    );

    // ---------------- смена ника ----------------
    app.get("/admin/nick-requests", async (req, reply) => {
      const q = z
        .object({ status: z.enum(["OPEN", "APPROVED", "REJECTED", "CLOSED"]).optional() })
        .parse(req.query);
      reply.send({ requests: await prismaStore.listNickRequestDetails(q.status as never) });
    });

    app.post<{ Params: { id: string } }>(
      "/admin/nick-requests/:id/approve",
      async (req, reply) => {
        const res = await approveNickChange(deps, req.params.id, {
          actorId: req.auth!.user.id,
          actorTgId: req.auth!.user.tgId,
          ip: getClientIp(req),
        });

        const user = await prismaStore.getUserById(res.player.userId);
        if (user) {
          const { sendMessage } = await import("../lib/telegram.js");
          await sendMessage(
            Number(user.tgId),
            `✅ <b>Ник одобрен</b>\nТеперь ты <code>${res.newNick}</code>.\nЕсли ты в whitelist — обнови ник в лаунчере и перезайди.`
          );
        }
        reply.send({ ok: true, newNick: res.newNick });
      }
    );

    app.post<{ Params: { id: string } }>(
      "/admin/nick-requests/:id/reject",
      async (req, reply) => {
        const body = RejectBody.parse(req.body ?? {});
        await rejectNickChange(
          deps,
          req.params.id,
          body.note ?? "",
          {
            actorId: req.auth!.user.id,
            actorTgId: req.auth!.user.tgId,
            ip: getClientIp(req),
          }
        );
        reply.send({ ok: true });
      }
    );

    // ---------------- рассылка ----------------
    app.post("/admin/broadcast", async (req, reply) => {
      const body = BroadcastBody.parse(req.body);
      const { broadcast } = await import("../adapters/notifier-helpers.js");

      const players = await prismaStore.listAllPlayers();
      const targets = players.filter((p) =>
        body.target === "ALL"
          ? true
          : body.target === "ACTIVE"
            ? p.status === "ACTIVE"
            : p.status === "EXPIRED"
      );

      const { id } = await prismaStore.createBroadcast({
        text: body.text,
        createdBy: req.auth!.user.id,
      });

      await prismaStore.updateBroadcast(id, {
        status: "SENDING",
        total: targets.length,
        startedAt: new Date(),
      });

      const result = await broadcast(
        deps,
        targets.map((p) => p.userId),
        body.text
      );

      await prismaStore.updateBroadcast(id, {
        status: result.failed > 0 && result.sent === 0 ? "FAILED" : "DONE",
        sent: result.sent,
        failed: result.failed,
        finishedAt: new Date(),
      });

      await prismaStore.writeAudit({
        actorId: req.auth!.user.id,
        actorTgId: req.auth!.user.tgId,
        action: AUDIT_ACTIONS.BROADCAST_SEND,
        entity: "Broadcast",
        entityId: id,
        meta: { target: body.target, ...result },
        ip: getClientIp(req),
      });

      reply.send({ id, ...result });
    });

    app.get("/admin/tickets/limits", async (_req, reply) => {
      reply.send({ limits: TICKET_LIMITS });
    });
  };
}
