import type { Context } from "grammy";
import type { MeResponse } from "../types.js";
import { callApi, humanApiError } from "../helpers.js";
import { texts, mainKeyboard } from "../texts.js";

export async function profileHandler(ctx: Context): Promise<void> {
  try {
    const me = await callApi<MeResponse>(ctx, "/me");
    const p = me.player;

    await ctx.reply(
      texts.profile({
        nick: p?.mcNick ?? null,
        status: p?.status ?? "PENDING",
        seasonName: p?.currentSeason?.name ?? me.offer.season?.name ?? null,
        seasonNumber:
          p?.currentSeason?.number ?? me.offer.season?.number ?? null,
        totalPaid: p?.totalPaid ?? 0,
        renewalCount: p?.renewalCount ?? 0,
        lastPaidAt: p?.lastPaidAt ?? null,
        offer: me.offer,
      }),
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  } catch (err) {
    await ctx.reply(`❌ ${humanApiError(err)}`, { reply_markup: mainKeyboard });
  }
}

export async function startHandler(ctx: Context): Promise<void> {
  await ctx.reply(texts.start(ctx.from?.first_name), {
    parse_mode: "HTML",
    reply_markup: mainKeyboard,
  });
}
