/**
 * Монитор здоровья API для бота.
 *
 * Стейт-машина:
 *   up       — HTTP 200 (ok)
 *   degraded — API отвечает 503 с body.status="degraded" (RCON/БД деградировали)
 *   down     — транспортный сбой или не-503 ошибка; алерт шлётся только
 *              после двух отказов ПОДРЯД (hysteresis) и только на переходе
 *              в down — чтобы деплой-ребуты не спамили алертами.
 *
 * Любой HTTP-ответ (включая degraded) сбрасывает downStreak: иначе после
 * первого алерта монитор перестал бы замечать реальные падения.
 */
export type ApiState = "up" | "degraded" | "down";

export interface HealthCheckResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<HealthCheckResponse>;

export type LogLevel = "info" | "warn" | "error";

export interface HealthMonitorOptions {
  /** Полный URL health-эндпоинта, например http://api:8080/health */
  url: string;
  /** Куда слать алерт (chat id). null/пусто — алерт не шлётся. */
  alertTarget?: string | number | null;
  /** Отправка алерта. Ошибки отправки игнорируются. */
  alertFn?: (text: string) => Promise<unknown>;
  /** Логгер (по умолчанию console). */
  log?: (level: LogLevel, message: string) => void;
  /** Инъекция fetch для тестов. */
  fetchFn?: FetchLike;
  /** Таймаут одной проверки, мс. */
  timeoutMs?: number;
  /** Сколько отказов подряд нужно для алерта. */
  failThreshold?: number;
}

export interface HealthMonitor {
  /** Выполнить одну проверку. Возвращает новое состояние. */
  check(): Promise<ApiState>;
  /** Текущее состояние (геттер). */
  readonly state: ApiState;
  readonly downStreak: number;
}

const defaultLog = (level: LogLevel, message: string): void => {
  if (level === "info") console.log(message);
  else if (level === "warn") console.warn(message);
  else console.error(message);
};

export function createHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  const {
    url,
    alertTarget,
    alertFn,
    log = defaultLog,
    fetchFn = ((u: string, init?: { signal?: AbortSignal }) => fetch(u, init)) as FetchLike,
    timeoutMs = 8000,
    failThreshold = 2,
  } = options;

  let apiState: ApiState = "up";
  let downStreak = 0;

  async function sendAlert(message: string): Promise<void> {
    if (!alertTarget || !alertFn) return;
    try {
      await alertFn(
        `🚨 <b>Loki Pass: API недоступен</b>\n<code>${message}</code>\n${url}`
      );
    } catch {
      // алерт не должен ронять мониторинг
    }
  }

  async function check(): Promise<ApiState> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetchFn(url, { signal: controller.signal });
      clearTimeout(t);

      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as { status?: string } | null;
        if (body?.status === "degraded") {
          // API жив (отвечает), просто деградировал — это не «сервер лёг».
          if (apiState === "down") log("info", "[bot] api снова отвечает (degraded)");
          if (apiState !== "degraded") log("warn", "[bot] api degraded: rcon/db недоступны");
          apiState = "degraded";
          downStreak = 0;
          return apiState;
        }
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (apiState !== "up") log("info", "[bot] api ok");
      apiState = "up";
      downStreak = 0;
      return apiState;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      downStreak++;
      // Алертим только после failThreshold отказов подряд — один чек
      // проходит в момент ребута/деплоя контейнера.
      if (downStreak < failThreshold) {
        log(
          "warn",
          `[bot] api check failed: ${msg} (ждём повторную проверку перед алертом)`
        );
        return apiState;
      }
      if (apiState !== "down") {
        apiState = "down";
        await sendAlert(msg);
        log("error", `[bot] api down: ${msg}`);
      }
      return apiState;
    }
  }

  return {
    check,
    get state() {
      return apiState;
    },
    get downStreak() {
      return downStreak;
    },
  };
}
