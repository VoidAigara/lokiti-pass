export interface GatewayCreateInput {
  amount: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  customer?: { email?: string; phone?: string };
}

export interface GatewayCreateResult {
  providerPaymentId: string | null;
  confirmationUrl: string | null;
}

/** Платёжный провайдер (YooKassa / Stars / ручной). */
export interface PaymentGateway {
  create(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  refund(input: {
    providerPaymentId: string;
    amount?: number;
    idempotencyKey: string;
  }): Promise<void>;
}

export interface WhitelistAddJob {
  action: "whitelist_add";
  paymentId: string;
  playerId: string;
  nick: string;
  seasonId: string;
}

export interface WhitelistRemoveJob {
  action: "whitelist_remove";
  playerId: string;
  nick: string;
  seasonId: string | null;
  reason?: string;
}

/** Очередь задач по whitelist (BullMQ). */
export interface WhitelistQueue {
  enqueueAdd(job: WhitelistAddJob): Promise<void>;
  enqueueRemove(job: WhitelistRemoveJob): Promise<void>;
}

/** Мост к Minecraft-серверу (RCON). */
export interface McBridge {
  whitelistAdd(nick: string): Promise<string>;
  whitelistRemove(nick: string): Promise<string>;
}

/** Уведомления игрокам в Telegram. */
export interface Notifier {
  accessGranted(tgId: string, info: { nick: string; seasonName: string; ip: string }): Promise<void>;
  accessRevoked(tgId: string, info: { nick: string; reason: string }): Promise<void>;
  paymentRefunded(tgId: string, info: { amount: number; reason: string }): Promise<void>;
  paymentFailed(tgId: string, info: { message: string }): Promise<void>;
  broadcast(tgId: string, html: string): Promise<void>;
}

/** Возврат платежа, оплаченного Telegram Stars (Bot API refundStarPayment). */
export interface StarsRefund {
  refund(input: { tgId: string; chargeId: string }): Promise<void>;
}

export interface Deps {
  store: import("./types.js").DomainStore;
  gateway: PaymentGateway;
  queue: WhitelistQueue;
  notifier: Notifier;
  mc: McBridge;
  starsRefund: StarsRefund;
  serverIp: string;
  webUrl: string;
  now?: () => Date;
}

export function nowOf(deps: Deps): Date {
  return deps.now ? deps.now() : new Date();
}
