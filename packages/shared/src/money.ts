/** Копейки → «500 ₽». */
export function formatKopecks(kopecks: number): string {
  const rub = kopecks / 100;
  const formatted = Number.isInteger(rub)
    ? String(rub)
    : rub.toFixed(2).replace(/\.00$/, "");
  return `${formatted} ₽`;
}

/** «500 ₽» → 50000 копеек. Бросает ошибку при некорректном вводе. */
export function parseRubToKopecks(input: string | number): number {
  const n =
    typeof input === "number" ? input : Number(String(input).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Некорректная сумма: ${input}`);
  }
  return Math.round(n * 100);
}
