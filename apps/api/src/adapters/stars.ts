import { refundStarPayment } from "../lib/telegram.js";
import type { StarsRefund } from "../services/ports.js";

export const telegramStarsRefund: StarsRefund = {
  async refund({ tgId, chargeId }) {
    await refundStarPayment(Number(tgId), chargeId);
  },
};
