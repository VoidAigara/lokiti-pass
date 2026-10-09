import { env } from "../config.js";
import { logger } from "./logger.js";

const API_BASE = "https://api.yookassa.ru/v3";

export interface YkAmount {
  value: string;
  currency: string;
}

export interface YkConfirmation {
  type: string;
  confirmation_url?: string;
}

export interface YkPayment {
  id: string;
  status:
    | "pending"
    | "waiting_for_capture"
    | "succeeded"
    | "canceled"
    | "refunded";
  amount: YkAmount;
  confirmation?: YkConfirmation;
  description?: string;
  metadata?: Record<string, string>;
  created_at: string;
  paid?: boolean;
  receipt?: unknown;
  refundable?: string;
}

export interface YkRefund {
  id: string;
  status: "pending" | "succeeded" | "canceled";
  amount: YkAmount;
  created_at: string;
}

function authHeader(): string {
  const raw = `${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export function isYooKassaConfigured(): boolean {
  return Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);
}

function rubToValue(kopecks: number): string {
  return (kopecks / 100).toFixed(2);
}

interface ReceiptItem {
  description: string;
  quantity: string;
  amount: { value: string; currency: string };
  vat_code: number;
  payment_subject: string;
  payment_mode: string;
}

/**
 * Чек по 54-ФЗ.
 * Включается флагом YOOKASSA_RECEIPT=true (см. .env.example).
 * Если вы работаете как ИП/самозанятый — обсудите с бухгалтерией
 * taxation_system и признаки предмета расчёта.
 */
function buildReceipt(
  description: string,
  amount: YkAmount
): { customer?: { email?: string; phone?: string }; items: ReceiptItem[]; tax_system_code?: number } | undefined {
  if (!env.YOOKASSA_RECEIPT) return undefined;
  return {
    items: [
      {
        description,
        quantity: "1.00",
        amount,
        vat_code: env.YOOKASSA_VAT_CODE,
        payment_subject: "service",
        payment_mode: "full_payment",
      },
    ],
    tax_system_code: env.YOOKASSA_TAXATION_SYSTEM,
  };
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotenceKey?: string } = {}
): Promise<T> {
  if (!isYooKassaConfigured()) {
    throw new Error("YooKassa не настроена (YOOKASSA_SHOP_ID / SECRET_KEY)");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: authHeader(),
        "Idempotence-Key":
          init.idempotenceKey ??
          env.YOOKASSA_IDEMPOTENCE_KEY ??
          crypto.randomUUID(),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const err = body as { description?: string; code?: string };
      logger.error(
        { status: res.status, path, description: err?.description },
        "YooKassa API error"
      );
      throw new YooKassaError(
        err?.description ?? `YooKassa ${res.status}`,
        res.status,
        err?.code
      );
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export class YooKassaError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "YooKassaError";
  }
}

export interface CreatePaymentParams {
  /** Копейки */
  amount: number;
  description: string;
  returnUrl: string;
  metadata?: Record<string, string>;
  idempotenceKey: string;
  receiptCustomer?: { email?: string; phone?: string };
}

export async function createYkPayment(
  params: CreatePaymentParams
): Promise<YkPayment> {
  const amount: YkAmount = {
    value: rubToValue(params.amount),
    currency: "RUB",
  };

  const receipt = buildReceipt(params.description, amount);

  const payload: Record<string, unknown> = {
    amount,
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: params.returnUrl,
    },
    description: params.description,
    metadata: params.metadata ?? {},
    ...(receipt
      ? { receipt: { ...receipt, customer: params.receiptCustomer } }
      : {}),
  };

  return request<YkPayment>("/payments", {
    method: "POST",
    idempotenceKey: params.idempotenceKey,
    body: JSON.stringify(payload),
  });
}

export async function getYkPayment(id: string): Promise<YkPayment> {
  return request<YkPayment>(`/payments/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

export async function refundYkPayment(params: {
  paymentId: string;
  amount?: number;
  idempotenceKey: string;
}): Promise<YkRefund> {
  const payload: Record<string, unknown> = { payment_id: params.paymentId };
  if (params.amount != null) {
    payload.amount = { value: rubToValue(params.amount), currency: "RUB" };
  }
  return request<YkRefund>("/refunds", {
    method: "POST",
    idempotenceKey: params.idempotenceKey,
    body: JSON.stringify(payload),
  });
}

/**
 * Проверка источника вебхука.
 * YooKassa не подписывает тело — доверяем по IP из их публикуемого списка.
 * Список задаётся в YOOKASSA_WEBHOOK_IPS через запятую (CIDR или точный IP).
 */
export function isYooKassaSourceIp(ip: string): boolean {
  const allowed = env.YOOKASSA_WEBHOOK_IPS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true; // не настроено — пропускаем (см. README)
  return allowed.some((cidr) => ipMatches(ip, cidr));
}

/** CIDR/IP совпадение (IPv4). */
export function ipMatches(ip: string, cidr: string): boolean {
  const clean = ip.replace("::ffff:", "").trim();
  if (!cidr.includes("/")) return clean === cidr.trim();

  const [range, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!range || !Number.isFinite(bits) || bits < 0 || bits > 32) return false;

  const ipNum = ipv4ToInt(clean);
  const rangeNum = ipv4ToInt(range);
  if (ipNum === null || rangeNum === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ipNum & mask) >>> 0) === ((rangeNum & mask) >>> 0);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}
