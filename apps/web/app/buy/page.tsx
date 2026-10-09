import { Suspense } from "react";
import type { Metadata } from "next";
import { BuyClient } from "./BuyClient";

export const metadata: Metadata = {
  title: "Купить проходку",
  description:
    "Оплата проходки на Loki Ti: карта, СБП или Telegram Stars. Автоматический доступ на whitelist.",
  alternates: { canonical: "/buy" },
};

export default function BuyPage() {
  return (
    <Suspense fallback={<div className="container py-24" />}>
      <BuyClient />
    </Suspense>
  );
}
