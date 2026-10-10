import type { Metadata } from "next";
import { MiniApp } from "./MiniApp";
import "./miniapp.css";

export const metadata: Metadata = {
  title: "Кабинет Loki Ti",
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <MiniApp />;
}
